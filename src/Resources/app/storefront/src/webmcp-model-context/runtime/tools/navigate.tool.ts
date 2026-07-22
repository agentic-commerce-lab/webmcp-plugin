import { z } from 'zod';
import { defineTool } from './define-tool';
import { MAX_URL_LENGTH, boundedString } from './schemas';
import { normalizeBaseUrl, normalizeSameOriginUrl } from './storefront-tool.utils';
import { navigateStorefront } from '../navigation';
import type { StorefrontToolOptions } from '../types';

export const NAVIGATE_TOOL_NAME = 'shopware_webmcp_navigate';

const navigateInput = z.object({
    url: boundedString(MAX_URL_LENGTH, 'Navigation URL').describe(
        'Same-origin storefront URL or path to open (e.g. a product, category, or /checkout/cart).',
    ),
});

export function createNavigateTool(options: StorefrontToolOptions = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);

    return defineTool({
        name: NAVIGATE_TOOL_NAME,
        title: 'Navigate',
        description:
            'Navigates the storefront to a same-origin URL on behalf of the shopper, e.g. to open a product, category, or the cart page.',
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        input: navigateInput,
        execute: async (input) => {
            const targetUrl = normalizeSameOriginUrl(input.url, baseUrl);

            if (!targetUrl) {
                throw new Error('Navigation URL must be a same-origin storefront URL or path.');
            }

            navigateStorefront(targetUrl);

            return {
                content: [{ type: 'text', text: `Navigating to ${targetUrl}.` }],
                structuredContent: { navigatedTo: targetUrl },
            };
        },
    });
}
