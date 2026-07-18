import { currentBaseUrl, isPlainObject, normalizeConfig, parseJson, safeString } from './config';
import { getModelContext } from './model-context/registry';
import type { ModelContextTool, UnknownRecord, WebMcpDocument, WebMcpRuntimeConfig } from './types';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Projects the WebMCP document from the live tool registry (the single source of
 * truth) plus any merchant-configured static elements. Core capabilities are the
 * registered tools themselves — not hand-written affordances — so the document and
 * the tools can no longer drift.
 */
export function buildWebMcpDocument(config: unknown = {}): WebMcpDocument {
    const normalizedConfig = normalizeConfig(config);
    const baseUrl = currentBaseUrl(normalizedConfig.baseUrl);

    return {
        version: '0.3',
        context: normalizedConfig.context,
        tools: projectRegisteredTools(),
        elements: createStaticElements(normalizedConfig, baseUrl),
    };
}

function projectRegisteredTools(): UnknownRecord[] {
    return getModelContext().tools.reduce((projected: UnknownRecord[], tool: ModelContextTool) => {
        if (tool && typeof tool.name === 'string') {
            projected.push(projectTool(tool));
        }

        return projected;
    }, []);
}

function projectTool(tool: ModelContextTool): UnknownRecord {
    const projected: UnknownRecord = { name: tool.name };

    if (tool.title) {
        projected.title = tool.title;
    }

    if (tool.description) {
        projected.description = tool.description;
    }

    if (tool.inputSchema) {
        projected.inputSchema = tool.inputSchema;
    }

    if (tool.annotations) {
        projected.annotations = tool.annotations;
    }

    return projected;
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
