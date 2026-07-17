import { ADD_TO_CART_TOOL_NAME, createAddToCartTool } from './runtime/tools/add-to-cart.tool';
import { createGetCartTool, GET_CART_TOOL_NAME } from './runtime/tools/get-cart.tool';
import {
    createGetProductCategoriesTool,
    GET_PRODUCT_CATEGORIES_TOOL_NAME,
} from './runtime/tools/get-product-categories.tool';
import { createGetProductTool, GET_PRODUCT_TOOL_NAME } from './runtime/tools/get-product.tool';
import { createRemoveFromCartTool, REMOVE_FROM_CART_TOOL_NAME } from './runtime/tools/remove-from-cart.tool';
import { createSearchProductsTool, SEARCH_PRODUCTS_TOOL_NAME } from './runtime/tools/search-products.tool';
import { createUpdateLineItemTool, UPDATE_LINE_ITEM_TOOL_NAME } from './runtime/tools/update-line-item.tool';
import type {
    ModelContextTool,
    StorefrontToolOptions,
    UnknownRecord,
    WebMcpDocument,
    WebMcpRuntimeConfig,
    WebMcpToolKey,
} from './runtime/types';
import { hasControlCharacters } from './runtime/tools/storefront-tool.utils';
import {
    addModelContextHelpers,
    getModelContext,
    registerModelContextTool,
    unregisterModelContextTool,
} from './runtime/model-context-registry';

const CONFIG_SELECTOR = '[data-swag-web-mcp-model-context]';
const CONFIG_OPTIONS_ATTRIBUTE = 'data-swag-web-mcp-model-context-options';
const DEFAULT_CONTEXT = 'Shopware storefront interaction graph';
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function bootstrapWebMcpModelContext(configOrElement: unknown = document.querySelector(CONFIG_SELECTOR)): {
    config: WebMcpRuntimeConfig;
    document: WebMcpDocument | null;
} {
    const config = normalizeConfig(readConfig(configOrElement));
    const webMcpDocument = config.enabled ? buildWebMcpDocument(config) : null;

    exposeGlobals(config, webMcpDocument);

    registerConfiguredTools(config);

    if (config.enabled) {
        document.dispatchEvent(
            new CustomEvent('webmcp:document-ready', {
                detail: {
                    document: webMcpDocument,
                    config,
                },
            }),
        );
    }

    return {
        config,
        document: webMcpDocument,
    };
}

export function buildWebMcpDocument(config: unknown = {}): WebMcpDocument {
    const normalizedConfig = normalizeConfig(config);
    const baseUrl = currentBaseUrl(normalizedConfig.baseUrl);

    return {
        version: '0.2',
        context: normalizedConfig.context,
        elements: [...createCoreShopwareElements(baseUrl), ...createStaticElements(normalizedConfig, baseUrl)],
        security: createSecurityDefinition(),
    };
}

export function registerConfiguredTools(config: unknown = {}): void {
    const normalizedConfig = normalizeConfig(config);

    addModelContextHelpers(getModelContext());

    registerSearchProductsTool(normalizedConfig);
    registerGetProductTool(normalizedConfig);
    registerGetProductCategoriesTool(normalizedConfig);
    registerGetCartTool(normalizedConfig);
    registerAddToCartTool(normalizedConfig);
    registerUpdateLineItemTool(normalizedConfig);
    registerRemoveFromCartTool(normalizedConfig);
}

export function registerSearchProductsTool(config: unknown = {}): ModelContextTool | null {
    return registerStorefrontTool(config, 'searchProducts', SEARCH_PRODUCTS_TOOL_NAME, createSearchProductsTool);
}

export function registerGetProductTool(config: unknown = {}): ModelContextTool | null {
    return registerStorefrontTool(config, 'getProduct', GET_PRODUCT_TOOL_NAME, createGetProductTool);
}

export function registerGetProductCategoriesTool(config: unknown = {}): ModelContextTool | null {
    return registerStorefrontTool(
        config,
        'getProductCategories',
        GET_PRODUCT_CATEGORIES_TOOL_NAME,
        createGetProductCategoriesTool,
    );
}

export function registerGetCartTool(config: unknown = {}): ModelContextTool | null {
    return registerStorefrontTool(config, 'getCart', GET_CART_TOOL_NAME, createGetCartTool);
}

export function registerAddToCartTool(config: unknown = {}): ModelContextTool | null {
    return registerStorefrontTool(config, 'addToCart', ADD_TO_CART_TOOL_NAME, createAddToCartTool);
}

export function registerUpdateLineItemTool(config: unknown = {}): ModelContextTool | null {
    return registerStorefrontTool(config, 'updateLineItem', UPDATE_LINE_ITEM_TOOL_NAME, createUpdateLineItemTool);
}

export function registerRemoveFromCartTool(config: unknown = {}): ModelContextTool | null {
    return registerStorefrontTool(config, 'removeFromCart', REMOVE_FROM_CART_TOOL_NAME, createRemoveFromCartTool);
}

function bootstrapFromDocument(): void {
    const configElement = document.querySelector(CONFIG_SELECTOR);

    if (configElement) {
        bootstrapWebMcpModelContext(configElement);
    }
}

function readConfig(configOrElement: unknown): UnknownRecord {
    if (isElement(configOrElement)) {
        const encodedOptions = configOrElement.getAttribute(CONFIG_OPTIONS_ATTRIBUTE);
        const inlineOptions = configOrElement.textContent;

        return (parseJson(encodedOptions) || parseJson(inlineOptions) || {}) as UnknownRecord;
    }

    if (isPlainObject(configOrElement) && Object.keys(configOrElement).length === 0) {
        const configElement = document.querySelector(CONFIG_SELECTOR);

        if (configElement) {
            return readConfig(configElement);
        }
    }

    return isPlainObject(configOrElement) ? configOrElement : {};
}

function exposeGlobals(config: WebMcpRuntimeConfig, webMcpDocument: WebMcpDocument | null): void {
    const getDocument = () => (config.enabled ? buildWebMcpDocument(config) : null);
    const getElements = () => {
        const currentDocument = getDocument();

        return currentDocument ? currentDocument.elements.slice() : [];
    };

    document.webMcp = {
        ...(isPlainObject(document.webMcp) ? document.webMcp : {}),
        document: webMcpDocument,
        getDocument,
        getElements,
    };

    window.SwagWebMcp = {
        ...(window.SwagWebMcp || {}),
        config,
        document: webMcpDocument,
        loaded: true,
        getDocument,
        getElements,
        registerConfiguredTools: () => registerConfiguredTools(config),
        registerSearchProductsTool: () => registerSearchProductsTool(config),
        registerGetProductTool: () => registerGetProductTool(config),
        registerGetProductCategoriesTool: () => registerGetProductCategoriesTool(config),
        registerGetCartTool: () => registerGetCartTool(config),
        registerAddToCartTool: () => registerAddToCartTool(config),
        registerUpdateLineItemTool: () => registerUpdateLineItemTool(config),
        registerRemoveFromCartTool: () => registerRemoveFromCartTool(config),
    };
}

function normalizeConfig(options: unknown = {}): WebMcpRuntimeConfig {
    const source = isPlainObject(options) ? options : {};
    const tools = isPlainObject(source.tools) ? source.tools : {};

    return {
        enabled: booleanOption(source.enabled, true),
        context: nonEmptyString(source.context) || DEFAULT_CONTEXT,
        baseUrl: nonEmptyString(source.baseUrl),
        storeApiAccessKey: nonEmptyString(source.storeApiAccessKey),
        navigationCategoryId: nonEmptyString(source.navigationCategoryId),
        activeCategoryId: nonEmptyString(source.activeCategoryId),
        currentProductId: nonEmptyString(source.currentProductId),
        staticElements: source.staticElements,
        staticElementsJson: nonEmptyString(source.staticElementsJson),
        tools: {
            searchProducts: booleanOption(tools.searchProducts, true),
            getProduct: booleanOption(tools.getProduct, true),
            getProductCategories: booleanOption(tools.getProductCategories, true),
            getCart: booleanOption(tools.getCart, true),
            addToCart: booleanOption(tools.addToCart, true),
            updateLineItem: booleanOption(tools.updateLineItem, true),
            removeFromCart: booleanOption(tools.removeFromCart, true),
        },
    };
}

function createCoreShopwareElements(baseUrl: string): UnknownRecord[] {
    return [
        {
            selector: 'form[action*="/search"] input[name="search"]',
            role: 'input.search',
            name: 'SEARCH_QUERY',
        },
        {
            selector: 'form[action*="/search"] button[type="submit"]',
            role: 'button.submit',
            name: 'SUBMIT_SEARCH',
            action: {
                kind: 'GET',
                endpoint: `${baseUrl}/search`,
                params: {
                    search: '$SEARCH_QUERY',
                },
            },
        },
        {
            selector: 'a[href*="/checkout/cart"], .header-cart',
            role: 'link.cart',
            name: 'VIEW_CART',
            action: {
                kind: 'GET',
                endpoint: `${baseUrl}/checkout/cart`,
            },
        },
        {
            selector: 'form[action*="/checkout/line-item/add"] button[type="submit"]',
            role: 'button.add_to_cart',
            name: 'ADD_TO_CART',
            action: {
                kind: 'POST',
                endpoint: '@ADD_TO_CART',
                csrf_tag: '$CSRF_TOKEN',
            },
        },
    ];
}

function createStaticElements(config: WebMcpRuntimeConfig, baseUrl: string): UnknownRecord[] {
    const source = config.staticElements || parseJson(config.staticElementsJson);
    const elements = Array.isArray(source)
        ? source
        : isPlainObject(source) && Array.isArray(source.elements)
          ? source.elements
          : [];

    return elements.reduce((normalizedElements: UnknownRecord[], element: unknown) => {
        const normalizedElement = normalizeElement(element, baseUrl);

        if (normalizedElement) {
            normalizedElements.push(normalizedElement);
        }

        return normalizedElements;
    }, []);
}

function normalizeElement(element: unknown, baseUrl: string): UnknownRecord | null {
    if (!isPlainObject(element)) {
        return null;
    }

    const selector = safeString(element.selector);
    const role = safeString(element.role);
    const name = safeString(element.name);

    if (!selector || !role || !name) {
        return null;
    }

    const normalizedElement: UnknownRecord = {
        selector,
        role,
        name,
    };
    const description = safeString(element.description);
    const action = normalizeAction(element.action, baseUrl);

    if (description) {
        normalizedElement.description = description.slice(0, 160);
    }

    if (action) {
        normalizedElement.action = action;
    }

    if (isPlainObject(element.metadata)) {
        normalizedElement.metadata = element.metadata;
    }

    return normalizedElement;
}

function normalizeAction(action: unknown, baseUrl: string): UnknownRecord | null {
    if (!isPlainObject(action)) {
        return null;
    }

    const kind = safeString(action.kind)?.toUpperCase();
    const endpoint = normalizeEndpoint(action.endpoint, baseUrl);

    if (!kind || !HTTP_METHODS.includes(kind) || !endpoint) {
        return null;
    }

    const normalizedAction: UnknownRecord = {
        kind,
        endpoint,
    };

    if (isPlainObject(action.params)) {
        normalizedAction.params = action.params;
    }

    ['csrf_tag', 'payload_jwe'].forEach((key) => {
        const value = safeString(action[key]);

        if (value) {
            normalizedAction[key] = value;
        }
    });

    return normalizedAction;
}

function normalizeEndpoint(endpoint: unknown, baseUrl: string): string | null {
    const value = safeString(endpoint);

    if (!value) {
        return null;
    }

    if (value.startsWith('@')) {
        return value;
    }

    if (value.startsWith('/')) {
        return `${baseUrl}${value}`;
    }

    if (!value.startsWith('https://') && !value.startsWith('http://')) {
        return null;
    }

    try {
        return new URL(value).toString();
    } catch (error) {
        return null;
    }
}

function createSecurityDefinition(): UnknownRecord {
    return {
        endpoints: {
            '@ADD_TO_CART': {
                tokenised: true,
                expires: 300,
                scopes: ['cart:write'],
            },
        },
        csrf: {
            token_field: '_csrf_token',
            header_name: 'X-CSRF-Token',
            mode: 'synchroniser',
        },
    };
}

function registerStorefrontTool(
    config: unknown,
    toolKey: WebMcpToolKey,
    toolName: string,
    createTool: (options: StorefrontToolOptions) => ModelContextTool,
): ModelContextTool | null {
    const normalizedConfig = normalizeConfig(config);

    if (!normalizedConfig.enabled || !normalizedConfig.tools[toolKey]) {
        unregisterModelContextTool(toolName);

        return null;
    }

    return registerModelContextTool(
        createTool({
            baseUrl: currentBaseUrl(normalizedConfig.baseUrl),
            accessKey: normalizedConfig.storeApiAccessKey,
            navigationCategoryId: normalizedConfig.navigationCategoryId,
            activeCategoryId: normalizedConfig.activeCategoryId,
            currentProductId: normalizedConfig.currentProductId,
        }),
    );
}

function currentBaseUrl(configuredBaseUrl: unknown): string {
    const fallbackBaseUrl = window.location.origin.replace(/\/+$/, '');

    if (!configuredBaseUrl) {
        return fallbackBaseUrl;
    }

    if (typeof configuredBaseUrl !== 'string') {
        return fallbackBaseUrl;
    }

    try {
        return new URL(configuredBaseUrl, fallbackBaseUrl).origin.replace(/\/+$/, '');
    } catch (error) {
        return fallbackBaseUrl;
    }
}

function parseJson(value: unknown): unknown {
    const json = nonEmptyString(value);

    if (!json) {
        return null;
    }

    try {
        return JSON.parse(json);
    } catch (error) {
        return null;
    }
}

function booleanOption(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value === 1;
    }

    if (typeof value === 'string') {
        switch (value.trim().toLowerCase()) {
            case '1':
            case 'true':
            case 'yes':
            case 'on':
                return true;
            case '0':
            case 'false':
            case 'no':
            case 'off':
                return false;
            default:
                return fallback;
        }
    }

    return fallback;
}

function safeString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    if (!trimmed || hasControlCharacters(trimmed)) {
        return null;
    }

    return trimmed;
}

function nonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return trimmed || null;
}

function isPlainObject(value: unknown): value is UnknownRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isElement(value: unknown): value is Element {
    return (
        Boolean(value) &&
        typeof value === 'object' &&
        value !== null &&
        'nodeType' in value &&
        (value as Node).nodeType === Node.ELEMENT_NODE
    );
}

window.SwagWebMcpRuntime = {
    ...(window.SwagWebMcpRuntime || {}),
    bootstrap: bootstrapWebMcpModelContext,
    buildDocument: buildWebMcpDocument,
    registerConfiguredTools,
    registerSearchProductsTool,
    registerGetProductTool,
    registerGetProductCategoriesTool,
    registerGetCartTool,
    registerAddToCartTool,
    registerUpdateLineItemTool,
    registerRemoveFromCartTool,
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapFromDocument, { once: true });
} else {
    bootstrapFromDocument();
}

window.addEventListener('load', bootstrapFromDocument, { once: true });
document.addEventListener('webmcp:model-context-request', bootstrapFromDocument);
document.addEventListener('webmcp:document-request', bootstrapFromDocument);
