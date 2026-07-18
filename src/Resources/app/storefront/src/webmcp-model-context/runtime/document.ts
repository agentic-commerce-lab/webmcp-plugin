import { currentBaseUrl, isPlainObject, normalizeConfig, parseJson, safeString } from './config';
import type { UnknownRecord, WebMcpDocument, WebMcpRuntimeConfig } from './types';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

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
