import { ADD_TO_CART_TOOL_NAME, createAddToCartTool } from './runtime/tools/add-to-cart.tool';
import { createGetCartTool, GET_CART_TOOL_NAME } from './runtime/tools/get-cart.tool';
import {
    createGetProductCategoriesTool,
    GET_PRODUCT_CATEGORIES_TOOL_NAME,
} from './runtime/tools/get-product-categories.tool';
import { createGetProductTool, GET_PRODUCT_TOOL_NAME } from './runtime/tools/get-product.tool';
import { createNavigateTool, NAVIGATE_TOOL_NAME } from './runtime/tools/navigate.tool';
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
import { currentBaseUrl, isElement, isPlainObject, normalizeConfig, parseJson } from './runtime/config';
import { buildWebMcpDocument } from './runtime/document';
import {
    addModelContextHelpers,
    getModelContext,
    registerModelContextTool,
    unregisterModelContextTool,
} from './runtime/model-context/registry';

export { buildWebMcpDocument };

const CONFIG_SELECTOR = '[data-swag-web-mcp-model-context]';
const CONFIG_OPTIONS_ATTRIBUTE = 'data-swag-web-mcp-model-context-options';

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

export function registerConfiguredTools(config: unknown = {}): void {
    const normalizedConfig = normalizeConfig(config);

    addModelContextHelpers(getModelContext());

    registerSearchProductsTool(normalizedConfig);
    registerGetProductTool(normalizedConfig);
    registerGetProductCategoriesTool(normalizedConfig);
    registerGetCartTool(normalizedConfig);
    registerAddToCartTool(normalizedConfig);
    registerUpdateLineItemTool(normalizedConfig);
    registerNavigateTool(normalizedConfig);
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

export function registerNavigateTool(config: unknown = {}): ModelContextTool | null {
    return registerStorefrontTool(config, 'navigate', NAVIGATE_TOOL_NAME, createNavigateTool);
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
        registerNavigateTool: () => registerNavigateTool(config),
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
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapFromDocument, { once: true });
} else {
    bootstrapFromDocument();
}

window.addEventListener('load', bootstrapFromDocument, { once: true });
document.addEventListener('webmcp:model-context-request', bootstrapFromDocument);
document.addEventListener('webmcp:document-request', bootstrapFromDocument);
