import { ShopwareClient } from '../shopware-client.js';
import {
    cleanText,
    fetchStorefrontHtml,
    isPlainObject,
    normalizeBaseUrl,
    normalizeSameOriginUrl,
    normalizeUrl,
    parseHtmlDocument,
} from './storefront-tool.utils.js';

export const GET_PRODUCT_CATEGORIES_TOOL_NAME = 'shopware_webmcp_get_product_categories';

const MAX_URL_LENGTH = 2048;
const MAX_SKU_LENGTH = 120;
const VALID_SCOPES = ['tree', 'product'];
const CATEGORY_LINK_SELECTOR = [
    '.main-navigation-link[href]',
    '.navigation-flyout-link[href]',
    '.navigation-flyout-category-link[href]',
    '.category-navigation-link[href]',
    '.cms-element-category-navigation a[href]',
    '.offcanvas-navigation a[href]',
].join(', ');
const DIRECT_CATEGORY_ID_ATTRIBUTES = [
    'data-category-id',
    'data-navigation-id',
    'data-flyout-menu-trigger',
];
const ANCESTOR_CATEGORY_ID_ATTRIBUTES = [
    'data-category-id',
    'data-navigation-id',
];
const PARENT_CATEGORY_ID_ATTRIBUTES = [
    'data-parent-id',
    'data-parent-category-id',
    'data-parent-navigation-id',
];

export function createGetProductCategoriesTool(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const shopwareClient = new ShopwareClient({
        baseUrl,
        accessKey: options.accessKey,
        contextToken: options.contextToken,
    });

    const execute = async (input = {}) => {
        const normalizedInput = normalizeInput(input, baseUrl);
        const source = await loadCategorySource(normalizedInput, baseUrl, shopwareClient);
        const result = normalizedInput.scope === 'product'
            ? extractProductCategoryResult(source.pageDocument, source.sourceUrl, baseUrl)
            : extractCategoryTreeResult(source.pageDocument, source.sourceUrl, baseUrl);

        return {
            content: [
                {
                    type: 'text',
                    text: formatCategoryResult(result),
                },
            ],
            structuredContent: {
                lookup: normalizedInput,
                ...result,
            },
        };
    };

    return {
        name: GET_PRODUCT_CATEGORIES_TOOL_NAME,
        title: 'Get product categories',
        description: 'Returns the storefront category tree or a product category path.',
        inputSchema: {
            type: 'object',
            properties: {
                scope: {
                    type: 'string',
                    enum: VALID_SCOPES,
                    default: 'tree',
                    description: 'Use tree for storefront navigation or product for categories assigned to a product page.',
                },
                sku: {
                    type: 'string',
                    maxLength: MAX_SKU_LENGTH,
                    description: 'Product SKU/product number. Implies product scope.',
                },
                url: {
                    type: 'string',
                    maxLength: MAX_URL_LENGTH,
                    description: 'Same-origin page URL or path. With product scope, this should be a product page.',
                },
            },
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function normalizeInput(input, baseUrl) {
    if (!isPlainObject(input)) {
        throw new Error('Get product categories input must be an object.');
    }

    const rawScope = typeof input.scope === 'string' && input.scope.trim() !== ''
        ? input.scope.trim()
        : null;
    const rawSku = typeof input.sku === 'string' && input.sku.trim() !== ''
        ? input.sku.trim()
        : null;
    const rawUrl = typeof input.url === 'string' && input.url.trim() !== ''
        ? input.url.trim()
        : null;
    const scope = rawScope || (rawSku || rawUrl ? 'product' : 'tree');

    if (!VALID_SCOPES.includes(scope)) {
        throw new Error(`Category scope must be one of: ${VALID_SCOPES.join(', ')}.`);
    }

    if (scope === 'tree' && rawSku) {
        throw new Error('SKU lookup is only supported with product category scope.');
    }

    if (scope === 'product' && rawSku && rawUrl) {
        throw new Error('Product category lookup must include either sku or url, not both.');
    }

    return {
        scope,
        ...(rawSku ? { sku: normalizeSku(rawSku) } : {}),
        ...(rawUrl ? { url: normalizeToolUrl(rawUrl, baseUrl) } : {}),
        useCurrentPage: !rawSku && !rawUrl,
    };
}

async function loadCategorySource(input, baseUrl, shopwareClient) {
    if (input.scope === 'tree' && input.useCurrentPage) {
        return {
            pageDocument: document,
            sourceUrl: normalizeUrl(window.location.href, baseUrl),
        };
    }

    if (input.scope === 'product' && input.useCurrentPage) {
        return {
            pageDocument: document,
            sourceUrl: normalizeUrl(window.location.href, baseUrl),
        };
    }

    const sourceUrl = input.sku
        ? await resolveProductUrlBySku(input.sku, shopwareClient)
        : input.url;
    const html = await fetchStorefrontHtml(sourceUrl, 'Category lookup');

    return {
        pageDocument: parseHtmlDocument(html, 'Category lookup'),
        sourceUrl,
    };
}

async function resolveProductUrlBySku(sku, shopwareClient) {
    const product = await shopwareClient.findProductBySku(sku);

    if (!product?.url) {
        throw new Error(`No product URL found for SKU ${sku}.`);
    }

    return product.url;
}

function normalizeToolUrl(rawUrl, baseUrl) {
    if (rawUrl.length > MAX_URL_LENGTH) {
        throw new Error(`Category source URL must be ${MAX_URL_LENGTH} characters or fewer.`);
    }

    if (/[\x00-\x1F\x7F]/.test(rawUrl)) {
        throw new Error('Category source URL must not contain control characters.');
    }

    const url = normalizeSameOriginUrl(rawUrl, baseUrl);

    if (!url) {
        throw new Error('Category source URL must be a same-origin storefront URL or path.');
    }

    return url;
}

function normalizeSku(rawSku) {
    if (rawSku.length > MAX_SKU_LENGTH) {
        throw new Error(`Product SKU must be ${MAX_SKU_LENGTH} characters or fewer.`);
    }

    if (/[\x00-\x1F\x7F]/.test(rawSku)) {
        throw new Error('Product SKU must not contain control characters.');
    }

    return rawSku;
}

function extractCategoryTreeResult(pageDocument, sourceUrl, baseUrl) {
    const rawEntries = collectCategoryLinkEntries(pageDocument, sourceUrl, baseUrl);
    const categories = buildNavigationCategories(rawEntries);

    return createCategoryResult('tree', 'navigation', sourceUrl, categories);
}

function extractProductCategoryResult(pageDocument, sourceUrl, baseUrl) {
    const rawCategories = extractBreadcrumbCategories(pageDocument, sourceUrl, baseUrl);
    const categories = buildProductCategoryPath(rawCategories);

    return createCategoryResult('product', 'breadcrumbs', sourceUrl, categories);
}

function collectCategoryLinkEntries(pageDocument, sourceUrl, baseUrl) {
    return Array.from(pageDocument.querySelectorAll(CATEGORY_LINK_SELECTOR))
        .map((linkElement, index) => normalizeCategoryLinkEntry(linkElement, index, sourceUrl, baseUrl))
        .filter(Boolean);
}

function normalizeCategoryLinkEntry(linkElement, index, sourceUrl, baseUrl) {
    const name = cleanText(linkElement.textContent)
        || cleanText(linkElement.getAttribute('title'))
        || cleanText(linkElement.getAttribute('aria-label'));
    const url = normalizeUrl(linkElement.getAttribute('href'), sourceUrl);

    if (!name || !url || !isSameOriginUrl(url, baseUrl) || isIgnoredCategoryUrl(url)) {
        return null;
    }

    const shopwareId = findElementCategoryId(linkElement);
    const flyoutParentShopwareId = cleanText(
        linkElement.closest('.navigation-flyout')?.getAttribute('data-flyout-menu-id'),
    );

    return {
        index,
        name,
        url,
        shopwareId,
        explicitParentShopwareId: findParentCategoryId(linkElement),
        flyoutParentShopwareId,
        active: isActiveCategoryElement(linkElement) || urlsMatch(url, sourceUrl),
        level: extractCategoryLevel(linkElement),
        groupKey: getCategoryGroupKey(linkElement, index),
    };
}

function buildNavigationCategories(rawEntries) {
    const categoriesById = new Map();
    const idByShopwareId = new Map();

    rawEntries.forEach((entry) => {
        entry.id = createCategoryId(entry);
        if (entry.shopwareId) {
            idByShopwareId.set(entry.shopwareId, entry.id);
        }

        const existingCategory = categoriesById.get(entry.id);
        if (existingCategory) {
            existingCategory.active = existingCategory.active || entry.active;
            existingCategory.sortIndex = Math.min(existingCategory.sortIndex, entry.index);
            existingCategory.shopwareId = existingCategory.shopwareId || entry.shopwareId;
            return;
        }

        categoriesById.set(entry.id, createCategory(entry, null));
    });

    assignExplicitParents(rawEntries, categoriesById, idByShopwareId);
    inferUrlParents(categoriesById);
    rebuildChildIds(categoriesById);
    propagateActiveState(categoriesById);

    return sortCategories(Array.from(categoriesById.values()));
}

function assignExplicitParents(rawEntries, categoriesById, idByShopwareId) {
    const groupStacks = new Map();

    rawEntries.forEach((entry) => {
        const category = categoriesById.get(entry.id);
        if (!category) {
            return;
        }

        const groupStack = groupStacks.get(entry.groupKey) || [];
        let parentId = entry.explicitParentShopwareId
            ? idByShopwareId.get(entry.explicitParentShopwareId)
            : null;

        if (!parentId && Number.isInteger(entry.level)) {
            parentId = entry.level > 0
                ? groupStack[entry.level - 1] || idByShopwareId.get(entry.flyoutParentShopwareId)
                : null;
            groupStack[entry.level] = entry.id;
            groupStack.length = entry.level + 1;
            groupStacks.set(entry.groupKey, groupStack);
        }

        if (!parentId && entry.flyoutParentShopwareId) {
            parentId = idByShopwareId.get(entry.flyoutParentShopwareId);
        }

        setParent(categoriesById, entry.id, parentId);
    });
}

function inferUrlParents(categoriesById) {
    const categories = Array.from(categoriesById.values());

    categories.forEach((category) => {
        if (category.parentId || !category.url) {
            return;
        }

        const parent = categories
            .filter((candidate) => candidate.id !== category.id && candidate.url)
            .filter((candidate) => isUrlParent(candidate.url, category.url))
            .sort((first, second) => normalizedPath(second.url).length - normalizedPath(first.url).length)[0];

        setParent(categoriesById, category.id, parent?.id);
    });
}

function rebuildChildIds(categoriesById) {
    categoriesById.forEach((category) => {
        category.childIds = [];
    });

    categoriesById.forEach((category) => {
        if (!category.parentId || !categoriesById.has(category.parentId)) {
            category.parentId = null;
            return;
        }

        const parent = categoriesById.get(category.parentId);
        if (!parent.childIds.includes(category.id)) {
            parent.childIds.push(category.id);
        }
    });

    categoriesById.forEach((category) => {
        category.childIds.sort((firstId, secondId) => {
            return categoriesById.get(firstId).sortIndex - categoriesById.get(secondId).sortIndex;
        });
    });
}

function propagateActiveState(categoriesById) {
    categoriesById.forEach((category) => {
        if (!category.active) {
            return;
        }

        let parentId = category.parentId;
        const visitedIds = new Set([category.id]);

        while (parentId && categoriesById.has(parentId) && !visitedIds.has(parentId)) {
            const parent = categoriesById.get(parentId);
            parent.active = true;
            visitedIds.add(parent.id);
            parentId = parent.parentId;
        }
    });
}

function extractBreadcrumbCategories(pageDocument, sourceUrl, baseUrl) {
    const productName = extractProductName(pageDocument);
    const categories = extractStructuredBreadcrumbCategories(pageDocument, sourceUrl)
        || extractDomBreadcrumbCategories(pageDocument, sourceUrl);

    return categories.filter((category) => {
        return !isHomeCategory(category, baseUrl)
            && !isProductBreadcrumb(category, productName, sourceUrl);
    });
}

function extractStructuredBreadcrumbCategories(pageDocument, sourceUrl) {
    const breadcrumbSchema = findSchemaValue(pageDocument, 'BreadcrumbList');

    if (!breadcrumbSchema || !Array.isArray(breadcrumbSchema.itemListElement)) {
        return null;
    }

    return breadcrumbSchema.itemListElement
        .map((item, index) => normalizeStructuredBreadcrumbItem(item, index, sourceUrl))
        .filter(Boolean);
}

function normalizeStructuredBreadcrumbItem(item, index, sourceUrl) {
    if (!isPlainObject(item)) {
        return null;
    }

    const linkedItem = item.item;
    const name = cleanText(item.name)
        || (isPlainObject(linkedItem) ? cleanText(linkedItem.name) : null);
    const urlValue = isPlainObject(linkedItem)
        ? linkedItem['@id'] || linkedItem.id || linkedItem.url
        : linkedItem;
    const url = normalizeUrl(urlValue, sourceUrl);

    if (!name) {
        return null;
    }

    return {
        index: Number(item.position) || index + 1,
        name,
        url,
        active: true,
    };
}

function extractDomBreadcrumbCategories(pageDocument, sourceUrl) {
    const breadcrumbLinks = Array.from(pageDocument.querySelectorAll(
        '.breadcrumb a[href], .breadcrumb-item a[href], nav[aria-label*="breadcrumb" i] a[href]',
    ));

    return breadcrumbLinks.map((linkElement, index) => {
        const name = cleanText(linkElement.textContent)
            || cleanText(linkElement.getAttribute('title'))
            || cleanText(linkElement.getAttribute('aria-label'));
        const url = normalizeUrl(linkElement.getAttribute('href'), sourceUrl);

        if (!name) {
            return null;
        }

        return {
            index,
            name,
            url,
            shopwareId: findElementCategoryId(linkElement),
            active: true,
        };
    }).filter(Boolean);
}

function buildProductCategoryPath(rawCategories) {
    const categories = [];
    const seenIds = new Set();

    rawCategories.forEach((entry, index) => {
        const id = createCategoryId(entry);

        if (seenIds.has(id)) {
            return;
        }

        const parent = categories[categories.length - 1] || null;
        const category = createCategory({ ...entry, id, active: true, index }, parent?.id || null);

        if (parent) {
            parent.childIds.push(category.id);
        }

        seenIds.add(id);
        categories.push(category);
    });

    return categories;
}

function createCategoryResult(scope, source, sourceUrl, categories) {
    return {
        scope,
        source,
        sourceUrl,
        count: categories.length,
        activeCategoryIds: categories.filter((category) => category.active).map((category) => category.id),
        categories: categories.map(stripInternalCategoryFields),
        tree: buildTree(categories),
    };
}

function createCategory(entry, parentId) {
    return {
        id: entry.id || createCategoryId(entry),
        idSource: entry.shopwareId ? 'shopware' : entry.url ? 'url' : 'name',
        shopwareId: entry.shopwareId || null,
        name: entry.name,
        parentId,
        childIds: [],
        active: Boolean(entry.active),
        url: entry.url || null,
        sortIndex: Number.isInteger(entry.index) ? entry.index : 0,
    };
}

function createCategoryId(entry) {
    if (entry.shopwareId) {
        return entry.shopwareId;
    }

    if (entry.url) {
        return `url:${normalizedPath(entry.url)}`;
    }

    return `name:${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function setParent(categoriesById, childId, parentId) {
    if (!parentId || childId === parentId || !categoriesById.has(childId) || !categoriesById.has(parentId)) {
        return;
    }

    if (wouldCreateCycle(categoriesById, childId, parentId)) {
        return;
    }

    categoriesById.get(childId).parentId = parentId;
}

function wouldCreateCycle(categoriesById, childId, parentId) {
    let currentParentId = parentId;
    const visitedIds = new Set();

    while (currentParentId && categoriesById.has(currentParentId)) {
        if (currentParentId === childId || visitedIds.has(currentParentId)) {
            return true;
        }

        visitedIds.add(currentParentId);
        currentParentId = categoriesById.get(currentParentId).parentId;
    }

    return false;
}

function buildTree(categories) {
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const roots = categories.filter((category) => !category.parentId || !categoriesById.has(category.parentId));

    return sortCategories(roots).map((category) => buildTreeNode(category, categoriesById, new Set()));
}

function buildTreeNode(category, categoriesById, visitedIds) {
    const nextVisitedIds = new Set(visitedIds);
    nextVisitedIds.add(category.id);

    return {
        ...stripInternalCategoryFields(category),
        children: category.childIds
            .map((childId) => categoriesById.get(childId))
            .filter((child) => child && !nextVisitedIds.has(child.id))
            .sort((first, second) => first.sortIndex - second.sortIndex)
            .map((child) => buildTreeNode(child, categoriesById, nextVisitedIds)),
    };
}

function stripInternalCategoryFields(category) {
    const normalizedCategory = {
        id: category.id,
        idSource: category.idSource,
        name: category.name,
        parentId: category.parentId,
        childIds: category.childIds.slice(),
        active: category.active,
    };

    if (category.shopwareId) {
        normalizedCategory.shopwareId = category.shopwareId;
    }

    if (category.url) {
        normalizedCategory.url = category.url;
    }

    return normalizedCategory;
}

function sortCategories(categories) {
    return categories.slice().sort((first, second) => {
        return first.sortIndex - second.sortIndex || first.name.localeCompare(second.name);
    });
}

function findSchemaValue(pageDocument, expectedType) {
    const scriptElements = Array.from(pageDocument.querySelectorAll('script[type="application/ld+json"]'));

    for (const scriptElement of scriptElements) {
        const schema = parseJson(scriptElement.textContent);
        const schemaValue = findSchemaTypeValue(schema, expectedType);

        if (schemaValue) {
            return schemaValue;
        }
    }

    return null;
}

function findSchemaTypeValue(value, expectedType) {
    if (Array.isArray(value)) {
        for (const item of value) {
            const schemaValue = findSchemaTypeValue(item, expectedType);

            if (schemaValue) {
                return schemaValue;
            }
        }

        return null;
    }

    if (!isPlainObject(value)) {
        return null;
    }

    if (schemaTypeMatches(value['@type'], expectedType)) {
        return value;
    }

    if (Array.isArray(value['@graph'])) {
        return findSchemaTypeValue(value['@graph'], expectedType);
    }

    return null;
}

function schemaTypeMatches(type, expectedType) {
    if (Array.isArray(type)) {
        return type.some((item) => schemaTypeMatches(item, expectedType));
    }

    return typeof type === 'string' && type.toLowerCase() === expectedType.toLowerCase();
}

function extractProductName(pageDocument) {
    return cleanText(pageDocument.querySelector('.product-detail-name, h1')?.textContent)
        || cleanText(pageDocument.querySelector('meta[property="og:title"]')?.getAttribute('content'));
}

function findElementCategoryId(element) {
    const directId = readAttributes(element, DIRECT_CATEGORY_ID_ATTRIBUTES);
    const body = element.ownerDocument?.body;

    if (directId) {
        return directId;
    }

    let currentElement = element.parentElement;
    while (currentElement && currentElement !== body) {
        const ancestorId = readAttributes(currentElement, ANCESTOR_CATEGORY_ID_ATTRIBUTES);

        if (ancestorId) {
            return ancestorId;
        }

        currentElement = currentElement.parentElement;
    }

    return null;
}

function findParentCategoryId(element) {
    let currentElement = element;
    const body = element.ownerDocument?.body;

    while (currentElement && currentElement !== body) {
        const parentId = readAttributes(currentElement, PARENT_CATEGORY_ID_ATTRIBUTES);

        if (parentId) {
            return parentId;
        }

        currentElement = currentElement.parentElement;
    }

    return null;
}

function readAttributes(element, attributes) {
    if (!element) {
        return null;
    }

    for (const attribute of attributes) {
        const value = cleanText(element.getAttribute(attribute));

        if (value) {
            return value;
        }
    }

    return null;
}

function extractCategoryLevel(element) {
    let currentElement = element;
    let depth = 0;

    while (currentElement && depth < 4) {
        const className = typeof currentElement.className === 'string' ? currentElement.className : '';
        const match = className.match(/(?:is-level|level)-(\d+)/);

        if (match) {
            return Number(match[1]);
        }

        currentElement = currentElement.parentElement;
        depth += 1;
    }

    if (element.matches('.main-navigation-link')) {
        return 0;
    }

    return null;
}

function getCategoryGroupKey(element, index) {
    const groupElement = element.closest(
        '.navigation-flyout, .category-navigation, .offcanvas-navigation, .main-navigation, nav',
    );

    if (!groupElement) {
        return `document:${index}`;
    }

    return cleanText(groupElement.getAttribute('data-flyout-menu-id'))
        || cleanText(groupElement.getAttribute('id'))
        || cleanText(groupElement.className)
        || 'document';
}

function isActiveCategoryElement(element) {
    return Boolean(
        element.matches('.active, .is-active, [aria-current]')
            || element.closest('.active, .is-active, [aria-current]'),
    );
}

function isHomeCategory(category, baseUrl) {
    const urlPath = category.url ? normalizedPath(category.url) : null;

    return urlPath === '/'
        || (['home', 'startseite'].includes(category.name.toLowerCase()) && isSameOriginUrl(category.url, baseUrl));
}

function isProductBreadcrumb(category, productName, sourceUrl) {
    if (category.url && urlsMatch(category.url, sourceUrl)) {
        return true;
    }

    return Boolean(productName && category.name.toLowerCase() === productName.toLowerCase());
}

function isIgnoredCategoryUrl(url) {
    let path;

    try {
        path = new URL(url).pathname.toLowerCase();
    } catch (error) {
        return true;
    }

    return ['/account', '/checkout', '/search', '/widgets', '/frontend-api', '/captcha'].some((prefix) => {
        return path === prefix || path.startsWith(`${prefix}/`);
    });
}

function isSameOriginUrl(url, baseUrl) {
    if (!url || !baseUrl) {
        return false;
    }

    try {
        return new URL(url).origin === new URL(baseUrl).origin;
    } catch (error) {
        return false;
    }
}

function urlsMatch(firstUrl, secondUrl) {
    if (!firstUrl || !secondUrl) {
        return false;
    }

    try {
        const first = new URL(firstUrl);
        const second = new URL(secondUrl);

        return first.origin === second.origin
            && normalizedPath(first.toString()) === normalizedPath(second.toString());
    } catch (error) {
        return false;
    }
}

function isUrlParent(parentUrl, childUrl) {
    const parentPath = normalizedPath(parentUrl);
    const childPath = normalizedPath(childUrl);

    return parentPath !== '/'
        && childPath !== parentPath
        && childPath.startsWith(`${parentPath}/`);
}

function normalizedPath(url) {
    try {
        const path = new URL(url).pathname.replace(/\/+$/, '');

        return path || '/';
    } catch (error) {
        return '/';
    }
}

function formatCategoryResult(result) {
    if (result.count === 0) {
        return result.scope === 'product'
            ? 'No product categories found.'
            : 'No storefront categories found.';
    }

    const lines = result.categories.map((category) => {
        const details = [
            category.id,
            category.parentId ? `parent: ${category.parentId}` : null,
            category.active ? 'active' : null,
            category.url,
        ].filter(Boolean).join(' - ');

        return `${category.name}${details ? ` - ${details}` : ''}`;
    });

    return `${result.count} ${result.scope === 'product' ? 'product' : 'storefront'} categor${result.count === 1 ? 'y' : 'ies'}:\n${lines.join('\n')}`;
}

function parseJson(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}
