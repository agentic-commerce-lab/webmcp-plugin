import {
    cleanText,
    fetchStorefrontHtml,
    isPlainObject,
    normalizeBaseUrl,
    normalizeSameOriginUrl,
    normalizeUrl,
    parseHtmlDocument,
    uniqueStrings,
} from './tools/storefront-tool.utils.js';

const STORE_API_PATH = '/store-api';
const WEBMCP_CART_PATH = '/webmcp/cart';
const STOREFRONT_ADD_TO_CART_PATH = '/checkout/line-item/add';
const STOREFRONT_OFFCANVAS_CART_PATH = '/checkout/offcanvas';
const STOREFRONT_CART_PATH = '/checkout/cart';
const STOREFRONT_CHANGE_LINE_ITEM_QUANTITY_PATH = '/checkout/line-item/change-quantity';
const STOREFRONT_REMOVE_FROM_CART_PATH = '/checkout/line-item/delete';
const CONTEXT_TOKEN_HEADER = 'sw-context-token';
const ACCESS_KEY_HEADER = 'sw-access-key';
const CONTEXT_TOKEN_STORAGE_KEY = 'sw-context-token';

export class ShopwareClient {
    constructor(options = {}) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.contextToken = cleanText(options.contextToken) || readContextToken();
        this.accessKey = cleanText(options.accessKey) || readAccessKey();
    }

    async searchProducts({ query, limit }) {
        const result = await this.storeApiRequest('/search', createProductCriteria({
            search: query,
            limit,
        }));
        const products = normalizeProductCollection(result, this.baseUrl);

        return {
            products,
            total: Number.isInteger(result?.total) ? result.total : products.length,
        };
    }

    async findProductBySku(sku) {
        const result = await this.storeApiRequest('/search', createProductCriteria({
            limit: 1,
            filter: [
                {
                    type: 'equals',
                    field: 'productNumber',
                    value: sku,
                },
            ],
        }));
        const products = normalizeProductCollection(result, this.baseUrl);

        if (products.length > 0) {
            return products[0];
        }

        const fallbackResult = await this.searchProducts({ query: sku, limit: 1 });

        return fallbackResult.products[0] || null;
    }

    async getProduct(input = {}) {
        const productId = await this.resolveProductId(input);
        const result = await this.storeApiRequest(`/product/${encodeURIComponent(productId)}`, createProductCriteria({
            limit: 1,
        }));
        const product = normalizeProduct(result?.product || result, this.baseUrl);

        if (!product) {
            throw new Error('No product details were returned by the Shopware Store API.');
        }

        return product;
    }

    async getCart() {
        const cart = await this.webMcpCartRequest();

        if (!isPlainObject(cart)) {
            throw new Error('No cart details were returned by the Shopware WebMCP cart endpoint.');
        }

        return cart;
    }

    async addProductToCart(input = {}) {
        const productId = await this.resolveProductId(input);
        const cart = await this.storefrontAddProductToCart({
            productId,
            quantity: input.quantity,
            lineItemId: cleanText(input.lineItemId) || productId,
        });

        return normalizeCart(cart);
    }

    async removeProductFromCart(input = {}) {
        const lineItemId = cleanText(input.lineItemId) || await this.resolveProductId(input);
        const cartLineItem = await this.findStorefrontCartLineItem(lineItemId);

        if (!cartLineItem) {
            throw new Error(`No cart line item found for ${lineItemId}.`);
        }

        const remainingQuantity = cartLineItem.quantity - input.quantity;
        const cart = remainingQuantity > 0
            ? await this.storefrontChangeLineItemQuantity({
                lineItemId,
                quantity: remainingQuantity,
                previousQuantity: cartLineItem.quantity,
                removedQuantity: input.quantity,
            })
            : await this.storefrontRemoveLineItemFromCart({
                lineItemId,
                previousQuantity: cartLineItem.quantity,
                removedQuantity: cartLineItem.quantity,
            });

        return normalizeCart(cart);
    }

    async updateLineItem(input = {}) {
        const lineItemIdInput = cleanText(input.lineItemId);
        const lineItemLookup = lineItemIdInput || await this.resolveProductId(input);
        const cartLineItem = await this.findStorefrontCartLineItem(lineItemLookup);

        if (!cartLineItem) {
            if (!lineItemIdInput && input.quantity > 0) {
                return this.addProductToCart(input);
            }

            throw new Error(`No cart line item found for ${lineItemLookup}.`);
        }

        const lineItemId = cartLineItem.id;
        const quantityDelta = input.quantity - cartLineItem.quantity;
        const cart = input.quantity > 0
            ? await this.storefrontChangeLineItemQuantity({
                lineItemId,
                quantity: input.quantity,
                previousQuantity: cartLineItem.quantity,
                removedQuantity: Math.max(cartLineItem.quantity - input.quantity, 0),
                quantityDelta,
                action: 'update',
            })
            : await this.storefrontRemoveLineItemFromCart({
                lineItemId,
                previousQuantity: cartLineItem.quantity,
                removedQuantity: cartLineItem.quantity,
                quantityDelta,
                action: 'update',
            });

        return normalizeCart(cart);
    }

    async resolveProductId(input = {}) {
        if (cleanText(input.id)) {
            return cleanText(input.id);
        }

        if (cleanText(input.sku)) {
            const product = await this.findProductBySku(cleanText(input.sku));

            if (!product?.id) {
                throw new Error(`No product found for SKU ${input.sku}.`);
            }

            return product.id;
        }

        if (cleanText(input.url)) {
            const productId = productIdFromUrl(input.url, this.baseUrl);

            if (productId) {
                return productId;
            }
        }

        throw new Error('Product lookup requires a Shopware product id, SKU/product number, or /detail/{id} URL.');
    }

    async storeApiRequest(path, body = {}) {
        const url = new URL(`${STORE_API_PATH}${path}`, this.baseUrl);
        const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        };

        if (this.accessKey) {
            headers[ACCESS_KEY_HEADER] = this.accessKey;
        }

        if (this.contextToken) {
            headers[CONTEXT_TOKEN_HEADER] = this.contextToken;
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify(body),
        });
        const responseContextToken = cleanText(response.headers.get(CONTEXT_TOKEN_HEADER));

        if (responseContextToken) {
            this.contextToken = responseContextToken;
            persistContextToken(responseContextToken);
        }

        const payload = await parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(storeApiErrorMessage(response, payload));
        }

        return payload;
    }

    async webMcpCartRequest() {
        const url = new URL(WEBMCP_CART_PATH, this.baseUrl);
        const response = await fetch(url.toString(), {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
        });
        const payload = await parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(webMcpCartErrorMessage(response, payload));
        }

        return payload;
    }

    async findStorefrontCartLineItem(lineItemId) {
        const currentDocumentLineItem = findCartLineItemInDocument(document, lineItemId, this.baseUrl);

        if (currentDocumentLineItem) {
            return currentDocumentLineItem;
        }

        try {
            const cart = await this.webMcpCartRequest();
            const payloadLineItem = findCartLineItemInPayload(cart, lineItemId);

            if (payloadLineItem) {
                return payloadLineItem;
            }
        } catch (error) {
            // Fall back to the storefront cart page when the optional cart endpoint is unavailable.
        }

        const cartHtml = await fetchStorefrontHtml(new URL(STOREFRONT_CART_PATH, this.baseUrl), 'Cart lookup');
        const cartDocument = parseHtmlDocument(cartHtml, 'Cart lookup');

        return findCartLineItemInDocument(cartDocument, lineItemId, this.baseUrl);
    }

    async storefrontAddProductToCart({ productId, quantity, lineItemId }) {
        const url = new URL(STOREFRONT_ADD_TO_CART_PATH, this.baseUrl);
        const body = createAddToCartFormBody({
            productId,
            lineItemId,
            quantity,
        });
        const csrfToken = readCsrfToken();
        const headers = {
            Accept: 'application/json, text/html, */*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
        };

        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
            body.set('_csrf_token', csrfToken);
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: body.toString(),
        });
        const payload = await parseFlexibleResponse(response);

        if (!response.ok) {
            throw new Error(storefrontErrorMessage(response, payload));
        }

        const cartWidgetRefreshed = publishCartMutation({
            action: 'add',
            productId,
            quantity,
            lineItemId,
        }, this.baseUrl);

        return isPlainObject(payload)
            ? {
                ...payload,
                cartWidgetRefreshed,
            }
            : {
                sessionCartUpdated: true,
                cartWidgetRefreshed,
                lineItems: [
                    {
                        id: lineItemId,
                        referencedId: productId,
                        type: 'product',
                        quantity,
                    },
                ],
            };
    }

    async storefrontChangeLineItemQuantity({
        lineItemId,
        quantity,
        previousQuantity,
        removedQuantity,
        quantityDelta,
        action = 'update',
    }) {
        const url = new URL(`${STOREFRONT_CHANGE_LINE_ITEM_QUANTITY_PATH}/${encodeURIComponent(lineItemId)}`, this.baseUrl);
        const body = new URLSearchParams();
        const csrfToken = readCsrfToken();
        const headers = {
            Accept: 'application/json, text/html, */*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
        };

        body.set('quantity', String(quantity));

        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
            body.set('_csrf_token', csrfToken);
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: body.toString(),
        });
        const payload = await parseFlexibleResponse(response);

        if (!response.ok) {
            throw new Error(storefrontErrorMessage(response, payload));
        }

        const cartWidgetRefreshed = publishCartMutation({
            action,
            lineItemId,
            previousQuantity,
            removedQuantity,
            quantityDelta: Number.isFinite(quantityDelta) ? quantityDelta : quantity - previousQuantity,
            remainingQuantity: quantity,
            lineItemDeleted: false,
        }, this.baseUrl);

        return isPlainObject(payload)
            ? {
                ...payload,
                cartWidgetRefreshed,
                lineItems: normalizeLineItems(payload.lineItems).length > 0 ? payload.lineItems : [
                    {
                        id: lineItemId,
                        quantity,
                    },
                ],
            }
            : {
                sessionCartUpdated: true,
                cartWidgetRefreshed,
                lineItems: [
                    {
                        id: lineItemId,
                        quantity,
                    },
                ],
            };
    }

    async storefrontRemoveLineItemFromCart({
        lineItemId,
        previousQuantity,
        removedQuantity,
        quantityDelta,
        action = 'remove',
    }) {
        const url = new URL(`${STOREFRONT_REMOVE_FROM_CART_PATH}/${encodeURIComponent(lineItemId)}`, this.baseUrl);
        const body = new URLSearchParams();
        const csrfToken = readCsrfToken();
        const headers = {
            Accept: 'application/json, text/html, */*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
        };

        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
            body.set('_csrf_token', csrfToken);
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: body.toString(),
        });
        const payload = await parseFlexibleResponse(response);

        if (!response.ok) {
            throw new Error(storefrontErrorMessage(response, payload));
        }

        const cartWidgetRefreshed = publishCartMutation({
            action,
            lineItemId,
            previousQuantity,
            removedQuantity,
            quantityDelta: Number.isFinite(quantityDelta) ? quantityDelta : -previousQuantity,
            remainingQuantity: 0,
            lineItemDeleted: true,
        }, this.baseUrl);

        return isPlainObject(payload)
            ? {
                ...payload,
                cartWidgetRefreshed,
            }
            : {
                sessionCartUpdated: true,
                cartWidgetRefreshed,
                lineItems: [],
            };
    }
}

function findCartLineItemInPayload(cart, lineItemId) {
    const lineItems = Array.isArray(cart?.lineItems) ? cart.lineItems : [];

    for (const lineItem of lineItems) {
        const matchedLineItem = findNestedCartLineItem(lineItem, lineItemId);

        if (matchedLineItem) {
            return matchedLineItem;
        }
    }

    return null;
}

function findNestedCartLineItem(lineItem, lineItemId) {
    if (!isPlainObject(lineItem)) {
        return null;
    }

    const candidateId = cleanText(lineItem.id);
    const candidateReferencedId = cleanText(lineItem.referencedId);

    if (
        (candidateId === lineItemId || candidateReferencedId === lineItemId)
        && candidateId
        && Number.isInteger(lineItem.quantity)
        && lineItem.quantity > 0
    ) {
        return {
            id: candidateId,
            quantity: lineItem.quantity,
        };
    }

    const children = Array.isArray(lineItem.children) ? lineItem.children : [];

    for (const child of children) {
        const matchedChild = findNestedCartLineItem(child, lineItemId);

        if (matchedChild) {
            return matchedChild;
        }
    }

    return null;
}

function findCartLineItemInDocument(root, lineItemId, baseUrl) {
    if (!root || typeof root.querySelectorAll !== 'function') {
        return null;
    }

    const forms = root.querySelectorAll([
        'form[action*="/checkout/line-item/change-quantity/"]',
        'form[action*="/checkout/line-item/delete/"]',
    ].join(','));

    for (const form of forms) {
        const candidateId = lineItemIdFromFormAction(form, baseUrl);

        if (candidateId !== lineItemId) {
            continue;
        }

        const quantity = readLineItemQuantity(form);

        if (quantity) {
            return {
                id: candidateId,
                quantity,
            };
        }
    }

    return null;
}

function lineItemIdFromFormAction(form, baseUrl) {
    const action = cleanText(form.getAttribute?.('action'));
    const url = action ? normalizeSameOriginUrl(action, baseUrl) : null;

    if (!url) {
        return null;
    }

    const path = new URL(url).pathname;
    const lineItemMatch = path.match(/\/checkout\/line-item\/(?:change-quantity|delete)\/([^/]+)(?:\/|$)/i);

    return lineItemMatch ? decodeURIComponent(lineItemMatch[1]) : null;
}

function readLineItemQuantity(form) {
    const formQuantity = readQuantityFromElement(form);

    if (formQuantity) {
        return formQuantity;
    }

    const container = form.closest?.([
        '[data-line-item-id]',
        '.cart-item',
        '.line-item',
        '.checkout-aside-item',
    ].join(','));

    return container ? readQuantityFromElement(container) : null;
}

function readQuantityFromElement(element) {
    const quantityField = element.querySelector?.([
        'input[name="quantity"]',
        'select[name="quantity"]',
        'input[name$="[quantity]"]',
        'select[name$="[quantity]"]',
        '[data-quantity]',
    ].join(','));
    const rawQuantity = quantityField?.value
        ?? quantityField?.getAttribute?.('value')
        ?? quantityField?.getAttribute?.('data-quantity');
    const quantity = Number(rawQuantity);

    return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

function createProductCriteria(options = {}) {
    const criteria = {
        associations: {
            cover: {
                associations: {
                    media: {},
                },
            },
            manufacturer: {},
            media: {},
            options: {
                associations: {
                    group: {},
                },
            },
            properties: {
                associations: {
                    group: {},
                },
            },
            seoUrls: {},
            categories: {
                associations: {
                    seoUrls: {},
                },
            },
        },
    };

    if (cleanText(options.search)) {
        criteria.search = cleanText(options.search);
    }

    if (Number.isInteger(options.limit)) {
        criteria.limit = options.limit;
    }

    if (Array.isArray(options.filter) && options.filter.length > 0) {
        criteria.filter = options.filter;
    }

    return criteria;
}

function normalizeProductCollection(result, baseUrl) {
    const elements = Array.isArray(result?.elements)
        ? result.elements
        : isPlainObject(result?.elements) ? Object.values(result.elements) : [];

    return elements
        .map((product) => normalizeProduct(product, baseUrl))
        .filter(Boolean);
}

function normalizeCart(cart) {
    if (!isPlainObject(cart)) {
        return null;
    }

    const lineItems = normalizeLineItems(cart.lineItems);

    return removeEmptyValues({
        sessionCartUpdated: cart.sessionCartUpdated,
        cartWidgetRefreshed: cart.cartWidgetRefreshed,
        name: cleanText(cart.name),
        itemCount: lineItems.reduce((count, item) => count + (item.quantity || 0), 0),
        totalPrice: normalizeCartPrice(cart.price),
        lineItems,
    });
}

function publishCartMutation(detail, baseUrl) {
    document.dispatchEvent(new CustomEvent('webmcp:cart-updated', {
        detail,
    }));

    const cartWidgetRefreshed = refreshCartWidgets();

    refreshCartSidebars(baseUrl);
    refreshCartPages(baseUrl);

    return cartWidgetRefreshed;
}

function refreshCartWidgets() {
    const instances = window.PluginManager?.getPluginInstances?.('CartWidget');
    let refreshed = false;

    if (!instances || typeof instances.forEach !== 'function') {
        return refreshed;
    }

    instances.forEach((instance) => {
        if (!instance || typeof instance.fetch !== 'function') {
            return;
        }

        try {
            const refreshResult = instance.fetch();

            if (refreshResult && typeof refreshResult.catch === 'function') {
                refreshResult.catch(() => {});
            }

            refreshed = true;
        } catch (error) {
            // Cart widget refresh is a best-effort UI sync after the cart mutation succeeds.
        }
    });

    return refreshed;
}

function refreshCartSidebars(baseUrl) {
    if (!findOpenCartSidebar()) {
        return false;
    }

    const offCanvasCartUrl = readOffCanvasCartUrl(baseUrl);

    if (!offCanvasCartUrl) {
        return false;
    }

    const refreshed = updateOpenOffCanvasCart(offCanvasCartUrl) || refreshOffCanvasCartPlugins(offCanvasCartUrl);

    if (refreshed) {
        document.dispatchEvent(new CustomEvent('webmcp:cart-sidebar-refresh-requested', {
            detail: {
                url: offCanvasCartUrl,
            },
        }));
    }

    return refreshed;
}

function updateOpenOffCanvasCart(offCanvasCartUrl) {
    const instances = getOffCanvasCartInstances();
    const instance = instances.find((candidate) => {
        return typeof candidate._updateOffCanvasContent === 'function';
    });

    if (!instance) {
        return false;
    }

    updateOpenOffCanvasCartContent(instance, offCanvasCartUrl).catch(() => {});

    return true;
}

async function updateOpenOffCanvasCartContent(instance, offCanvasCartUrl) {
    const html = await fetchStorefrontHtml(new URL(offCanvasCartUrl), 'Cart sidebar refresh');

    if (!findOpenCartSidebar() || typeof instance._updateOffCanvasContent !== 'function') {
        return;
    }

    instance._updateOffCanvasContent(html);
}

function refreshOffCanvasCartPlugins(offCanvasCartUrl) {
    const instances = getOffCanvasCartInstances();

    let refreshed = false;

    instances.forEach((instance) => {
        if (refreshed || !instance || typeof instance.openOffCanvas !== 'function') {
            return;
        }

        try {
            instance.openOffCanvas(offCanvasCartUrl, false);
            refreshed = true;
        } catch (error) {
            // Cart sidebar refresh is best-effort after the cart mutation succeeds.
        }
    });

    return refreshed;
}

function getOffCanvasCartInstances() {
    const instances = window.PluginManager?.getPluginInstances?.('OffCanvasCart');
    const normalizedInstances = [];

    if (!instances || typeof instances.forEach !== 'function') {
        return normalizedInstances;
    }

    instances.forEach((instance) => {
        if (instance) {
            normalizedInstances.push(instance);
        }
    });

    return normalizedInstances;
}

function findOpenCartSidebar() {
    const sidebar = document.querySelector('.offcanvas.cart-offcanvas, .cart-offcanvas');

    return sidebar && isVisibleElement(sidebar) ? sidebar : null;
}

function readOffCanvasCartUrl(baseUrl) {
    const configuredUrl = cleanText(window.router?.['frontend.cart.offcanvas']);
    const url = normalizeSameOriginUrl(configuredUrl || STOREFRONT_OFFCANVAS_CART_PATH, baseUrl);

    return url || normalizeUrl(STOREFRONT_OFFCANVAS_CART_PATH, baseUrl);
}

function refreshCartPages(baseUrl) {
    if (!isCurrentCartPage()) {
        return false;
    }

    const refreshEvent = new CustomEvent('webmcp:cart-page-refresh-requested', {
        cancelable: true,
        detail: {
            url: normalizeUrl(STOREFRONT_CART_PATH, baseUrl),
            targetSelector: '.checkout',
        },
    });

    if (!document.dispatchEvent(refreshEvent)) {
        return false;
    }

    refreshCartPage(baseUrl).catch(() => {});

    return true;
}

async function refreshCartPage(baseUrl) {
    const html = await fetchStorefrontHtml(new URL(STOREFRONT_CART_PATH, baseUrl), 'Cart page refresh');

    if (!isCurrentCartPage()) {
        return;
    }

    const cartDocument = parseHtmlDocument(html, 'Cart page refresh');
    const refreshedElement = replaceCartPageElement(cartDocument);

    if (!refreshedElement) {
        return;
    }

    initializeShopwarePlugins(refreshedElement);

    document.dispatchEvent(new CustomEvent('webmcp:cart-page-refreshed', {
        detail: {
            element: refreshedElement,
        },
    }));
}

function isCurrentCartPage() {
    const path = window.location?.pathname || '';

    if (/\/checkout\/cart\/?$/i.test(path)) {
        return true;
    }

    const bodyClassList = document.body?.classList;

    if (bodyClassList?.contains('is-ctl-checkout') && bodyClassList.contains('is-act-cart')) {
        return true;
    }

    return false;
}

function replaceCartPageElement(cartDocument) {
    const currentElement = document.querySelector('.checkout');
    const freshElement = cartDocument.querySelector('.checkout');

    if (!currentElement || !freshElement) {
        return null;
    }

    const replacement = freshElement.cloneNode(true);

    currentElement.replaceWith(replacement);

    return replacement;
}

function initializeShopwarePlugins(parentElement) {
    const pluginManager = window.PluginManager;

    try {
        if (parentElement && typeof pluginManager?.initializePluginsInParentElement === 'function') {
            const result = pluginManager.initializePluginsInParentElement(parentElement);

            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }

            return;
        }

        const result = pluginManager?.initializePlugins?.();

        if (result && typeof result.catch === 'function') {
            result.catch(() => {});
        }
    } catch (error) {
        // Cart page fragment plugin initialization is best-effort after the rendered HTML is replaced.
    }
}

function isVisibleElement(element) {
    if (!element || element.closest?.('[aria-hidden="true"], [hidden]')) {
        return false;
    }

    return Boolean(element.offsetParent || element.getClientRects?.().length);
}

function normalizeLineItems(collection) {
    const items = Array.isArray(collection)
        ? collection
        : isPlainObject(collection?.elements) ? Object.values(collection.elements)
            : isPlainObject(collection) ? Object.values(collection) : [];

    return items.map((item) => {
        return removeEmptyValues({
            id: cleanText(item.id),
            referencedId: cleanText(item.referencedId),
            type: cleanText(item.type),
            label: cleanText(item.label),
            quantity: Number.isFinite(item.quantity) ? item.quantity : null,
            price: normalizeCartPrice(item.price),
            payload: normalizeLineItemPayload(item.payload),
        });
    }).filter((item) => item.id || item.label);
}

function normalizeCartPrice(price) {
    if (!isPlainObject(price)) {
        return null;
    }

    return removeEmptyValues({
        unitPrice: Number.isFinite(price.unitPrice) ? price.unitPrice : null,
        totalPrice: Number.isFinite(price.totalPrice) ? price.totalPrice : null,
        positionPrice: Number.isFinite(price.positionPrice) ? price.positionPrice : null,
        netPrice: Number.isFinite(price.netPrice) ? price.netPrice : null,
    });
}

function normalizeLineItemPayload(payload) {
    if (!isPlainObject(payload)) {
        return null;
    }

    return removeEmptyValues({
        productNumber: cleanText(payload.productNumber),
        parentId: cleanText(payload.parentId),
        optionIds: Array.isArray(payload.optionIds) ? payload.optionIds.filter((value) => cleanText(value)) : null,
    });
}

function normalizeProduct(product, baseUrl) {
    if (!isPlainObject(product)) {
        return null;
    }

    const translated = isPlainObject(product.translated) ? product.translated : {};
    const name = cleanText(translated.name) || cleanText(product.name);

    if (!product.id || !name) {
        return null;
    }

    const calculatedPrice = normalizePrice(product.calculatedPrice || product.calculatedPrices?.[0]);
    const coverImage = normalizeProductImage(product.cover, baseUrl);
    const mediaImages = normalizeMediaImages(product.media, baseUrl);
    const images = uniqueStrings([coverImage, ...mediaImages]);

    return removeEmptyValues({
        id: product.id,
        sku: cleanText(product.productNumber),
        productNumber: cleanText(product.productNumber),
        name,
        description: cleanText(translated.description) || cleanText(product.description),
        manufacturer: normalizeManufacturer(product.manufacturer),
        price: calculatedPrice.formatted,
        priceValue: calculatedPrice.value,
        currency: calculatedPrice.currency,
        active: product.active,
        available: product.available,
        stock: Number.isFinite(product.stock) ? product.stock : null,
        url: normalizeProductUrl(product, baseUrl),
        image: images[0] || null,
        images,
        options: normalizeOptionValues(product.options),
        properties: normalizeOptionValues(product.properties),
        categories: normalizeCategories(product.categories, baseUrl),
    });
}

function normalizeProductUrl(product, baseUrl) {
    const seoUrl = Array.isArray(product.seoUrls)
        ? product.seoUrls.find((candidate) => candidate?.isCanonical) || product.seoUrls[0]
        : null;
    const seoPath = cleanText(seoUrl?.seoPathInfo || seoUrl?.pathInfo);

    if (seoPath) {
        return normalizeUrl(seoPath, baseUrl);
    }

    return normalizeUrl(`/detail/${product.id}`, baseUrl);
}

function normalizePrice(price) {
    if (!isPlainObject(price)) {
        return {};
    }

    const value = typeof price.unitPrice === 'number'
        ? price.unitPrice
        : typeof price.totalPrice === 'number' ? price.totalPrice : null;

    return {
        value,
        currency: cleanText(price.currency?.isoCode) || null,
        formatted: Number.isFinite(value) ? String(value) : null,
    };
}

function normalizeProductImage(cover, baseUrl) {
    const media = cover?.media || cover;

    return normalizeUrl(media?.url, baseUrl);
}

function normalizeMediaImages(mediaCollection, baseUrl) {
    const mediaItems = Array.isArray(mediaCollection)
        ? mediaCollection
        : isPlainObject(mediaCollection?.elements) ? Object.values(mediaCollection.elements) : [];

    return mediaItems.map((item) => normalizeProductImage(item.media || item, baseUrl)).filter(Boolean);
}

function normalizeManufacturer(manufacturer) {
    if (!isPlainObject(manufacturer)) {
        return null;
    }

    const translated = isPlainObject(manufacturer.translated) ? manufacturer.translated : {};

    return cleanText(translated.name) || cleanText(manufacturer.name);
}

function normalizeOptionValues(collection) {
    const items = Array.isArray(collection)
        ? collection
        : isPlainObject(collection?.elements) ? Object.values(collection.elements) : [];

    return items.map((item) => {
        const translated = isPlainObject(item.translated) ? item.translated : {};
        const groupTranslated = isPlainObject(item.group?.translated) ? item.group.translated : {};

        return removeEmptyValues({
            id: item.id,
            name: cleanText(translated.name) || cleanText(item.name),
            group: cleanText(groupTranslated.name) || cleanText(item.group?.name),
        });
    }).filter((item) => item.name);
}

function normalizeCategories(collection, baseUrl) {
    const items = Array.isArray(collection)
        ? collection
        : isPlainObject(collection?.elements) ? Object.values(collection.elements) : [];

    return items.map((category) => {
        const translated = isPlainObject(category.translated) ? category.translated : {};

        return removeEmptyValues({
            id: category.id,
            name: cleanText(translated.name) || cleanText(category.name),
            parentId: cleanText(category.parentId),
            active: category.active,
            url: normalizeCategoryUrl(category, baseUrl),
        });
    }).filter((category) => category.id && category.name);
}

function normalizeCategoryUrl(category, baseUrl) {
    const seoUrl = Array.isArray(category.seoUrls)
        ? category.seoUrls.find((candidate) => candidate?.isCanonical) || category.seoUrls[0]
        : null;
    const seoPath = cleanText(seoUrl?.seoPathInfo || seoUrl?.pathInfo);

    return seoPath ? normalizeUrl(seoPath, baseUrl) : null;
}

function productIdFromUrl(value, baseUrl) {
    const url = normalizeSameOriginUrl(value, baseUrl);

    if (!url) {
        return null;
    }

    const path = new URL(url).pathname;
    const detailMatch = path.match(/\/detail\/([a-f0-9-]{32,36})(?:\/|$)/i);

    return detailMatch?.[1]?.replace(/-/g, '') || null;
}

async function parseJsonResponse(response) {
    const text = await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return {
            raw: text,
        };
    }
}

async function parseFlexibleResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (!text) {
        return null;
    }

    if (contentType.includes('application/json')) {
        try {
            return JSON.parse(text);
        } catch (error) {
            return {
                raw: text,
            };
        }
    }

    return {
        raw: text,
    };
}

function storeApiErrorMessage(response, payload) {
    const errorDetail = Array.isArray(payload?.errors)
        ? payload.errors.map((error) => error.detail || error.title).filter(Boolean).join(' ')
        : null;

    if (response.status === 401 || response.status === 403) {
        return errorDetail || 'Shopware Store API request was rejected. The storefront may need an exposed sw-access-key or valid context token.';
    }

    return errorDetail || `Shopware Store API request failed with status ${response.status}.`;
}

function storefrontErrorMessage(response, payload) {
    if (Array.isArray(payload?.errors)) {
        const errorDetail = payload.errors.map((error) => error.detail || error.title).filter(Boolean).join(' ');

        if (errorDetail) {
            return errorDetail;
        }
    }

    return `Shopware storefront cart request failed with status ${response.status}.`;
}

function webMcpCartErrorMessage(response, payload) {
    if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
    }

    return `Shopware WebMCP cart request failed with status ${response.status}.`;
}

function createAddToCartFormBody({ productId, lineItemId, quantity }) {
    const body = new URLSearchParams();
    const lineItemPrefix = `lineItems[${lineItemId}]`;

    body.set(`${lineItemPrefix}[id]`, lineItemId);
    body.set(`${lineItemPrefix}[referencedId]`, productId);
    body.set(`${lineItemPrefix}[type]`, 'product');
    body.set(`${lineItemPrefix}[stackable]`, '1');
    body.set(`${lineItemPrefix}[removable]`, '1');
    body.set(`${lineItemPrefix}[quantity]`, String(quantity));

    return body;
}

function readContextToken() {
    return readKnownValue([
        () => readMetaContent('sw-context-token'),
        () => readStorageValue(CONTEXT_TOKEN_STORAGE_KEY),
        () => readStorageValue('swContextToken'),
        () => readCookieValue(CONTEXT_TOKEN_STORAGE_KEY),
        () => readCookieValue('sw_context_token'),
    ]);
}

function readCsrfToken() {
    return readKnownValue([
        () => document.querySelector('form[action*="/checkout/line-item/add"] input[name="_csrf_token"]')?.value,
        () => document.querySelector('input[name="_csrf_token"]')?.value,
        () => readMetaContent('csrf-token'),
        () => readMetaContent('csrf_token'),
        () => window?.csrf?.token,
        () => window?.Shopware?.Context?.csrfToken,
    ]);
}

function readAccessKey() {
    return readKnownValue([
        () => readMetaContent('sw-access-key'),
        () => readMetaContent('shopware-store-api-access-key'),
        () => window?.storefrontSettings?.storeApi?.accessKey,
        () => window?.storefrontSettings?.salesChannel?.accessKey,
        () => window?.Shopware?.StoreApi?.accessKey,
        () => window?.Shopware?.Context?.accessKey,
        () => window?.swAccessKey,
    ]);
}

function readKnownValue(readers) {
    for (const reader of readers) {
        try {
            const value = cleanText(reader());

            if (value) {
                return value;
            }
        } catch (error) {
            // Ignore inaccessible browser storage.
        }
    }

    return null;
}

function readMetaContent(name) {
    return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
}

function readStorageValue(key) {
    return window.localStorage?.getItem(key) || window.sessionStorage?.getItem(key);
}

function readCookieValue(name) {
    const encodedName = `${encodeURIComponent(name)}=`;
    const cookie = document.cookie
        .split(';')
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(encodedName));

    return cookie ? decodeURIComponent(cookie.slice(encodedName.length)) : null;
}

function persistContextToken(contextToken) {
    try {
        window.localStorage?.setItem(CONTEXT_TOKEN_STORAGE_KEY, contextToken);
    } catch (error) {
        // Ignore inaccessible browser storage.
    }
}

function removeEmptyValues(value) {
    return Object.entries(value).reduce((normalizedValue, [key, item]) => {
        if (item === null || typeof item === 'undefined' || item === '') {
            return normalizedValue;
        }

        if (Array.isArray(item) && item.length === 0) {
            return normalizedValue;
        }

        normalizedValue[key] = item;

        return normalizedValue;
    }, {});
}
