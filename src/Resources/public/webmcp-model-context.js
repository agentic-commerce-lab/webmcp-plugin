const CONFIG_SELECTOR = '[data-swag-web-mcp-model-context]';
const CONFIG_OPTIONS_ATTRIBUTE = 'data-swag-web-mcp-model-context-options';
const DEFAULT_CONTEXT = 'Shopware storefront interaction graph';
const HELLO_WORLD_TOOL_NAME = 'shopware.webmcp.hello_world';
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function bootstrapWebMcpModelContext(configOrElement = document.querySelector(CONFIG_SELECTOR)) {
    const config = normalizeConfig(readConfig(configOrElement));
    const webMcpDocument = config.enabled ? buildWebMcpDocument(config) : null;

    exposeGlobals(config, webMcpDocument);

    if (config.enabled) {
        registerConfiguredTools(config);

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

    if (normalizedConfig.enabled && normalizedConfig.tools.helloWorld) {
        registerHelloWorldTool();
    }
}

export function registerHelloWorldTool() {
    const modelContext = getModelContext();
    const tool = createHelloWorldTool();

    upsertTool(modelContext, tool);
    addModelContextHelpers(modelContext);

    document.dispatchEvent(new CustomEvent('webmcp:model-context-ready', {
        detail: {
            toolName: HELLO_WORLD_TOOL_NAME,
            modelContext,
        },
    }));
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
        registerHelloWorldTool,
    };
}

function normalizeConfig(options = {}) {
    const source = isPlainObject(options) ? options : {};
    const tools = isPlainObject(source.tools) ? source.tools : {};

    return {
        enabled: booleanOption(source.enabled, true),
        context: nonEmptyString(source.context) || DEFAULT_CONTEXT,
        baseUrl: nonEmptyString(source.baseUrl),
        staticElements: source.staticElements,
        staticElementsJson: nonEmptyString(source.staticElementsJson),
        tools: {
            helloWorld: booleanOption(tools.helloWorld, true),
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

function createHelloWorldTool() {
    const execute = async (input = {}) => {
        const subject = typeof input.subject === 'string' && input.subject.trim() !== ''
            ? input.subject.trim()
            : 'world';

        return {
            content: [
                {
                    type: 'text',
                    text: `Hello, ${subject} from Shopware WebMCP.`,
                },
            ],
        };
    };

    return {
        name: HELLO_WORLD_TOOL_NAME,
        title: 'Hello world',
        description: 'Returns a hello world response from the Shopware storefront.',
        inputSchema: {
            type: 'object',
            properties: {
                subject: {
                    type: 'string',
                    description: 'Optional name or subject to greet.',
                },
            },
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function upsertTool(modelContext, tool) {
    const existingIndex = modelContext.tools.findIndex((candidate) => {
        return candidate && candidate.name === tool.name;
    });

    if (existingIndex >= 0) {
        modelContext.tools[existingIndex] = tool;

        return;
    }

    if (typeof modelContext.registerTool === 'function') {
        modelContext.registerTool(tool);
    }

    const registeredIndex = modelContext.tools.findIndex((candidate) => {
        return candidate && candidate.name === tool.name;
    });

    if (registeredIndex < 0) {
        modelContext.tools.push(tool);
    }
}

function addModelContextHelpers(modelContext) {
    if (typeof modelContext.getTools !== 'function') {
        modelContext.getTools = () => modelContext.tools.slice();
    }

    if (typeof modelContext.callTool !== 'function') {
        modelContext.callTool = async (name, input = {}) => {
            const tool = modelContext.tools.find((candidate) => candidate && candidate.name === name);

            if (!tool || typeof tool.execute !== 'function') {
                throw new Error(`Unknown modelContext tool: ${name}`);
            }

            return tool.execute(input);
        };
    }
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
    registerHelloWorldTool,
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapFromDocument, { once: true });
} else {
    bootstrapFromDocument();
}

window.addEventListener('load', bootstrapFromDocument, { once: true });
document.addEventListener('webmcp:model-context-request', bootstrapFromDocument);
document.addEventListener('webmcp:document-request', bootstrapFromDocument);
