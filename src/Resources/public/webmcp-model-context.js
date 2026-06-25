import {
    ADD_TO_CART_TOOL_NAME,
    createAddToCartTool,
} from './webmcp-model-context/tools/add-to-cart.tool.js';
import {
    createGetCartTool,
    GET_CART_TOOL_NAME,
} from './webmcp-model-context/tools/get-cart.tool.js';
import {
    createGetProductCategoriesTool,
    GET_PRODUCT_CATEGORIES_TOOL_NAME,
} from './webmcp-model-context/tools/get-product-categories.tool.js';
import {
    createGetProductTool,
    GET_PRODUCT_TOOL_NAME,
} from './webmcp-model-context/tools/get-product.tool.js';
import {
    createRemoveFromCartTool,
    REMOVE_FROM_CART_TOOL_NAME,
} from './webmcp-model-context/tools/remove-from-cart.tool.js';
import {
    createSearchProductsTool,
    SEARCH_PRODUCTS_TOOL_NAME,
} from './webmcp-model-context/tools/search-products.tool.js';
import {
    createUpdateLineItemTool,
    UPDATE_LINE_ITEM_TOOL_NAME,
} from './webmcp-model-context/tools/update-line-item.tool.js';

const CONFIG_SELECTOR = '[data-swag-web-mcp-model-context]';
const CONFIG_OPTIONS_ATTRIBUTE = 'data-swag-web-mcp-model-context-options';
const DEFAULT_CONTEXT = 'Shopware storefront interaction graph';
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SWAG_WEB_MCP_TOOL_NAME_PREFIX = 'shopware_webmcp_';
const ORIGINAL_GET_TOOLS_KEY = '__swagWebMcpOriginalGetTools';
const ORIGINAL_CALL_TOOL_KEY = '__swagWebMcpOriginalCallTool';
const WRAPPED_HELPER_KEY = '__swagWebMcpWrapped';
const NATIVE_TOOL_REGISTRY_KEY = '__swagWebMcpNativeToolRegistry';

export function bootstrapWebMcpModelContext(configOrElement = document.querySelector(CONFIG_SELECTOR)) {
    const config = normalizeConfig(readConfig(configOrElement));
    const webMcpDocument = config.enabled ? buildWebMcpDocument(config) : null;

    exposeGlobals(config, webMcpDocument);

    registerConfiguredTools(config);

    if (config.enabled) {
        document.dispatchEvent(new CustomEvent('webmcp:document-ready', {
            detail: {
                document: webMcpDocument,
                config,
            },
        }));
    }

    return {
        config,
        document: webMcpDocument,
    };
}

export function buildWebMcpDocument(config = {}) {
    const normalizedConfig = normalizeConfig(config);
    const baseUrl = currentBaseUrl(normalizedConfig.baseUrl);

    return {
        version: '0.2',
        context: normalizedConfig.context,
        elements: [
            ...createCoreShopwareElements(baseUrl),
            ...createStaticElements(normalizedConfig, baseUrl),
        ],
        security: createSecurityDefinition(),
    };
}

export function registerConfiguredTools(config = {}) {
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

export function registerSearchProductsTool(config = {}) {
    return registerStorefrontTool(config, 'searchProducts', SEARCH_PRODUCTS_TOOL_NAME, createSearchProductsTool);
}

export function registerGetProductTool(config = {}) {
    return registerStorefrontTool(config, 'getProduct', GET_PRODUCT_TOOL_NAME, createGetProductTool);
}

export function registerGetProductCategoriesTool(config = {}) {
    return registerStorefrontTool(
        config,
        'getProductCategories',
        GET_PRODUCT_CATEGORIES_TOOL_NAME,
        createGetProductCategoriesTool,
    );
}

export function registerGetCartTool(config = {}) {
    return registerStorefrontTool(config, 'getCart', GET_CART_TOOL_NAME, createGetCartTool);
}

export function registerAddToCartTool(config = {}) {
    return registerStorefrontTool(config, 'addToCart', ADD_TO_CART_TOOL_NAME, createAddToCartTool);
}

export function registerUpdateLineItemTool(config = {}) {
    return registerStorefrontTool(config, 'updateLineItem', UPDATE_LINE_ITEM_TOOL_NAME, createUpdateLineItemTool);
}

export function registerRemoveFromCartTool(config = {}) {
    return registerStorefrontTool(config, 'removeFromCart', REMOVE_FROM_CART_TOOL_NAME, createRemoveFromCartTool);
}

function bootstrapFromDocument() {
    const configElement = document.querySelector(CONFIG_SELECTOR);

    if (configElement) {
        bootstrapWebMcpModelContext(configElement);
    }
}

function readConfig(configOrElement) {
    if (isElement(configOrElement)) {
        const encodedOptions = configOrElement.getAttribute(CONFIG_OPTIONS_ATTRIBUTE);
        const inlineOptions = configOrElement.textContent;

        return parseJson(encodedOptions) || parseJson(inlineOptions) || {};
    }

    if (isPlainObject(configOrElement) && Object.keys(configOrElement).length === 0) {
        const configElement = document.querySelector(CONFIG_SELECTOR);

        if (configElement) {
            return readConfig(configElement);
        }
    }

    return isPlainObject(configOrElement) ? configOrElement : {};
}

function exposeGlobals(config, webMcpDocument) {
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

function normalizeConfig(options = {}) {
    const source = isPlainObject(options) ? options : {};
    const tools = isPlainObject(source.tools) ? source.tools : {};

    return {
        enabled: booleanOption(source.enabled, true),
        context: nonEmptyString(source.context) || DEFAULT_CONTEXT,
        baseUrl: nonEmptyString(source.baseUrl),
        storeApiAccessKey: nonEmptyString(source.storeApiAccessKey),
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

function createCoreShopwareElements(baseUrl) {
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

function createStaticElements(config, baseUrl) {
    const source = config.staticElements || parseJson(config.staticElementsJson);
    const elements = Array.isArray(source)
        ? source
        : isPlainObject(source) && Array.isArray(source.elements) ? source.elements : [];

    return elements.reduce((normalizedElements, element) => {
        const normalizedElement = normalizeElement(element, baseUrl);

        if (normalizedElement) {
            normalizedElements.push(normalizedElement);
        }

        return normalizedElements;
    }, []);
}

function normalizeElement(element, baseUrl) {
    if (!isPlainObject(element)) {
        return null;
    }

    const selector = safeString(element.selector);
    const role = safeString(element.role);
    const name = safeString(element.name);

    if (!selector || !role || !name) {
        return null;
    }

    const normalizedElement = {
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

function normalizeAction(action, baseUrl) {
    if (!isPlainObject(action)) {
        return null;
    }

    const kind = safeString(action.kind)?.toUpperCase();
    const endpoint = normalizeEndpoint(action.endpoint, baseUrl);

    if (!HTTP_METHODS.includes(kind) || !endpoint) {
        return null;
    }

    const normalizedAction = {
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

function normalizeEndpoint(endpoint, baseUrl) {
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

function createSecurityDefinition() {
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

function getModelContext() {
    if (!isPlainObject(document.modelContext)) {
        document.modelContext = {};
    }

    if (!Array.isArray(document.modelContext.tools)) {
        document.modelContext.tools = [];
    }

    return document.modelContext;
}

function getExistingModelContext() {
    if (!isPlainObject(document.modelContext) || !Array.isArray(document.modelContext.tools)) {
        return null;
    }

    return document.modelContext;
}

function registerStorefrontTool(config, toolKey, toolName, createTool) {
    const normalizedConfig = normalizeConfig(config);

    if (!normalizedConfig.enabled || !normalizedConfig.tools[toolKey]) {
        unregisterModelContextTool(toolName);

        return null;
    }

    return registerModelContextTool(createTool({
        baseUrl: currentBaseUrl(normalizedConfig.baseUrl),
        accessKey: normalizedConfig.storeApiAccessKey,
    }));
}

function registerModelContextTool(tool) {
    const modelContext = getModelContext();

    upsertTool(modelContext, tool);
    addModelContextHelpers(modelContext);
    const nativeToolName = registerNativeModelContextTool(tool);

    document.dispatchEvent(new CustomEvent('webmcp:model-context-ready', {
        detail: {
            toolName: tool.name,
            nativeToolName,
            modelContext,
        },
    }));

    return tool;
}

function unregisterModelContextTool(toolName) {
    const modelContext = getExistingModelContext();

    if (!modelContext) {
        return false;
    }

    const previousLength = modelContext.tools.length;

    modelContext.tools = modelContext.tools.filter((candidate) => {
        return candidate && candidate.name !== toolName;
    });
    const nativeToolRemoved = unregisterNativeModelContextTool(toolName);
    addModelContextHelpers(modelContext);

    if (modelContext.tools.length !== previousLength || nativeToolRemoved) {
        document.dispatchEvent(new CustomEvent('webmcp:model-context-ready', {
            detail: {
                toolName,
                modelContext,
            },
        }));
    }

    return modelContext.tools.length !== previousLength || nativeToolRemoved;
}

function upsertTool(modelContext, tool) {
    const existingIndex = modelContext.tools.findIndex((candidate) => {
        return candidate && candidate.name === tool.name;
    });

    if (existingIndex >= 0) {
        modelContext.tools[existingIndex] = tool;

        return;
    }

    const registeredIndex = modelContext.tools.findIndex((candidate) => {
        return candidate && candidate.name === tool.name;
    });

    if (registeredIndex < 0) {
        modelContext.tools.push(tool);
    }
}

function addModelContextHelpers(modelContext) {
    if (
        typeof modelContext.getTools === 'function'
        && !modelContext.getTools[WRAPPED_HELPER_KEY]
        && typeof modelContext[ORIGINAL_GET_TOOLS_KEY] !== 'function'
    ) {
        modelContext[ORIGINAL_GET_TOOLS_KEY] = modelContext.getTools.bind(modelContext);
    }

    if (
        typeof modelContext.callTool === 'function'
        && !modelContext.callTool[WRAPPED_HELPER_KEY]
        && typeof modelContext[ORIGINAL_CALL_TOOL_KEY] !== 'function'
    ) {
        modelContext[ORIGINAL_CALL_TOOL_KEY] = modelContext.callTool.bind(modelContext);
    }

    const getTools = () => getVisibleModelContextTools(modelContext);
    getTools[WRAPPED_HELPER_KEY] = true;
    modelContext.getTools = getTools;

    const callTool = async (name, input = {}) => callVisibleModelContextTool(modelContext, name, input);
    callTool[WRAPPED_HELPER_KEY] = true;
    modelContext.callTool = callTool;
}

function getVisibleModelContextTools(modelContext) {
    const visibleTools = [];

    appendOriginalModelContextTools(modelContext, visibleTools);

    modelContext.tools.forEach((tool) => {
        appendVisibleModelContextTool(visibleTools, tool, true);
    });

    return visibleTools;
}

function appendOriginalModelContextTools(modelContext, visibleTools) {
    const originalGetTools = modelContext[ORIGINAL_GET_TOOLS_KEY];

    if (typeof originalGetTools !== 'function') {
        return;
    }

    let originalTools;

    try {
        originalTools = originalGetTools();
    } catch (error) {
        return;
    }

    if (!Array.isArray(originalTools)) {
        return;
    }

    originalTools.forEach((tool) => {
        appendVisibleModelContextTool(visibleTools, tool, false);
    });
}

function appendVisibleModelContextTool(visibleTools, tool, includeSwagWebMcpTools) {
    if (!tool || typeof tool.name !== 'string') {
        return;
    }

    if (!includeSwagWebMcpTools && isSwagWebMcpToolName(tool.name)) {
        return;
    }

    if (visibleTools.some((candidate) => candidate && candidate.name === tool.name)) {
        return;
    }

    visibleTools.push(tool);
}

async function callVisibleModelContextTool(modelContext, name, input) {
    const tool = getVisibleModelContextTools(modelContext).find((candidate) => {
        return candidate && candidate.name === name;
    });

    if (isSwagWebMcpToolName(name)) {
        if (!tool || typeof tool.execute !== 'function') {
            throw new Error(`Unknown modelContext tool: ${name}`);
        }

        return tool.execute(input);
    }

    const originalCallTool = modelContext[ORIGINAL_CALL_TOOL_KEY];

    if (typeof originalCallTool === 'function') {
        return originalCallTool(name, input);
    }

    if (!tool || typeof tool.execute !== 'function') {
        throw new Error(`Unknown modelContext tool: ${name}`);
    }

    return tool.execute(input);
}

function registerNativeModelContextTool(tool) {
    const nativeModelContext = getNativeModelContext();

    if (!nativeModelContext) {
        return null;
    }

    const registry = getNativeToolRegistry();
    const existingNativeToolName = registry.get(tool.name);

    if (existingNativeToolName) {
        return existingNativeToolName;
    }

    const nativeTool = createNativeModelContextTool(tool);

    if (tryRegisterNativeModelContextTool(nativeModelContext, nativeTool)) {
        registry.set(tool.name, tool.name);

        return tool.name;
    }

    return null;
}

function unregisterNativeModelContextTool(toolName) {
    const nativeModelContext = getNativeModelContext();
    const registry = getNativeToolRegistry();
    const registeredNativeToolName = registry.get(toolName);
    const nativeToolName = registeredNativeToolName || toolName;
    let removed = false;

    if (nativeModelContext && typeof nativeModelContext.unregisterTool === 'function') {
        try {
            nativeModelContext.unregisterTool(nativeToolName);
        } catch (error) {
            try {
                nativeModelContext.unregisterTool({ name: nativeToolName });
            } catch (nestedError) {
                // The fallback registry still removes disabled tools even when the native API cannot unregister.
            }
        }
    }

    if (registry.delete(toolName)) {
        removed = true;
    }

    return removed;
}

function getNativeModelContext() {
    const candidates = [
        typeof navigator !== 'undefined' ? navigator.modelContext : null,
        typeof document !== 'undefined' ? document.modelContext : null,
        typeof navigator !== 'undefined' ? navigator.modelContextTesting : null,
    ];

    return candidates.find((candidate) => {
        return Boolean(candidate)
            && typeof candidate === 'object'
            && typeof candidate.registerTool === 'function';
    }) || null;
}

function createNativeModelContextTool(tool) {
    const execute = async (input = {}) => {
        const result = await tool.execute(normalizeNativeToolInput(input));

        return serializeNativeToolResult(result);
    };

    return removeEmptyValues({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        execute,
        handler: execute,
    });
}

function tryRegisterNativeModelContextTool(nativeModelContext, nativeTool) {
    const registerTool = nativeModelContext.registerTool.bind(nativeModelContext);
    const attempts = [
        () => registerTool(nativeTool),
        () => registerTool(nativeTool.name, nativeTool),
        () => registerTool(nativeTool.name, {
            description: nativeTool.description,
            inputSchema: nativeTool.inputSchema,
            annotations: nativeTool.annotations,
        }, nativeTool.handler),
        () => registerTool(nativeTool.name, nativeTool.description, nativeTool.inputSchema, nativeTool.handler),
    ];

    for (const attempt of attempts) {
        try {
            const result = attempt();

            if (result && typeof result.catch === 'function') {
                result.catch(() => {
                    unregisterNativeModelContextTool(nativeTool.name);
                });
            }

            return true;
        } catch (error) {
            // Try the next experimental WebMCP registration signature.
        }
    }

    return false;
}

function normalizeNativeToolInput(input) {
    if (typeof input !== 'string') {
        return input ?? {};
    }

    const trimmedInput = input.trim();

    if (!trimmedInput) {
        return {};
    }

    try {
        return JSON.parse(trimmedInput);
    } catch (error) {
        throw new Error('WebMCP tool input must be valid JSON.');
    }
}

function serializeNativeToolResult(result) {
    if (typeof result === 'string') {
        return result;
    }

    try {
        return JSON.stringify(result);
    } catch (error) {
        return String(result);
    }
}

function getNativeToolRegistry() {
    if (!(window[NATIVE_TOOL_REGISTRY_KEY] instanceof Map)) {
        window[NATIVE_TOOL_REGISTRY_KEY] = new Map();
    }

    return window[NATIVE_TOOL_REGISTRY_KEY];
}

function isSwagWebMcpToolName(name) {
    return typeof name === 'string' && name.startsWith(SWAG_WEB_MCP_TOOL_NAME_PREFIX);
}

function currentBaseUrl(configuredBaseUrl) {
    const fallbackBaseUrl = window.location.origin.replace(/\/+$/, '');

    if (!configuredBaseUrl) {
        return fallbackBaseUrl;
    }

    try {
        return new URL(configuredBaseUrl, fallbackBaseUrl).origin.replace(/\/+$/, '');
    } catch (error) {
        return fallbackBaseUrl;
    }
}

function parseJson(value) {
    if (!nonEmptyString(value)) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

function booleanOption(value, fallback) {
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

function safeString(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    if (!trimmed || /[\x00-\x1F\x7F]/.test(trimmed)) {
        return null;
    }

    return trimmed;
}

function nonEmptyString(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return trimmed || null;
}

function removeEmptyValues(value) {
    return Object.entries(value).reduce((normalizedValue, [key, item]) => {
        if (item === null || typeof item === 'undefined' || item === '') {
            return normalizedValue;
        }

        normalizedValue[key] = item;

        return normalizedValue;
    }, {});
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isElement(value) {
    return Boolean(value) && value.nodeType === Node.ELEMENT_NODE;
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
