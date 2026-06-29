import {
    isPlainObject,
    normalizeBaseUrl,
    normalizeOptionalStringField,
    normalizeSameOriginUrl,
} from './storefront-tool.utils';
import type { StorefrontToolOptions } from '../types';

export const NAVIGATE_TOOL_NAME = 'shopware_webmcp_navigate';

const MAX_URL_LENGTH = 2048;

interface NavigateInput {
    url: string;
}

interface NavigationTarget {
    url: string;
}

export function createNavigateTool(options: StorefrontToolOptions = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);

    const execute = async (input = {}) => {
        const normalizedInput = normalizeInput(input, baseUrl);
        const target = resolveNavigationTarget(normalizedInput);
        const navigated = requestNavigation(target);

        return {
            content: [
                {
                    type: 'text',
                    text: navigated
                        ? `Navigating to ${target.url}.`
                        : `Navigation to ${target.url} was cancelled.`,
                },
            ],
            structuredContent: {
                lookup: normalizedInput,
                target,
                navigated,
            },
        };
    };

    return {
        name: NAVIGATE_TOOL_NAME,
        title: 'Navigate',
        description: 'Navigates the current storefront tab to a same-origin URL.',
        inputSchema: {
            type: 'object',
            required: ['url'],
            properties: {
                url: {
                    type: 'string',
                    maxLength: MAX_URL_LENGTH,
                    description: 'Same-origin storefront URL or path. Use product tools to discover product URLs.',
                },
            },
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function normalizeInput(input: unknown, baseUrl: string): NavigateInput {
    if (!isPlainObject(input)) {
        throw new Error('Navigate input must be an object.');
    }

    const url = normalizeOptionalStringField(input.url, MAX_URL_LENGTH, 'Navigation URL');

    if (!url) {
        throw new Error('Navigate input must include a url.');
    }

    const normalizedUrl = normalizeSameOriginUrl(url, baseUrl);

    if (!normalizedUrl) {
        throw new Error('Navigation URL must be a same-origin storefront URL or path.');
    }

    return {
        url: normalizedUrl,
    };
}

function resolveNavigationTarget(input: NavigateInput): NavigationTarget {
    return {
        url: input.url,
    };
}

function requestNavigation(target: NavigationTarget): boolean {
    const event = new CustomEvent('webmcp:navigation-requested', {
        cancelable: true,
        detail: target,
    });

    if (!document.dispatchEvent(event)) {
        return false;
    }

    window.setTimeout(() => {
        window.location.assign(target.url);
    }, 0);

    return true;
}
