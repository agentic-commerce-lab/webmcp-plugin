import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { hasExactlyOne, productSelectorShape } from './schemas';
import { navigateStorefront } from '../navigation';
import type { ProductSummary, StorefrontToolOptions } from '../types';

export const GET_PRODUCT_TOOL_NAME = 'shopware_webmcp_get_product';

const getProductInput = z
    .object({
        ...productSelectorShape,
        showResults: z
            .boolean()
            .default(true)
            .describe(
                "Navigate the shopper to the product detail page so they see it in their browser. This runs in the shopper's own tab, so keep it true when the shopper wants to look at the product; set false to only fetch details for reasoning (e.g. to answer a question about it).",
            ),
    })
    .refine((value) => hasExactlyOne([value.id, value.sku, value.url]), {
        message: 'Provide exactly one of id, sku, or url.',
    });

export function createGetProductTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: GET_PRODUCT_TOOL_NAME,
        title: 'Get product',
        description:
            'Returns product details and, by default, opens the product detail page for the shopper. Provide exactly one of id, sku, or url. Set showResults false to only fetch details as data (e.g. to answer a question or pick a variant).',
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: getProductInput,
        execute: async (input) => {
            const product = await shopwareClient.getProduct(input);
            const productUrl = typeof product.url === 'string' ? product.url : null;
            const showInBrowser = input.showResults && Boolean(productUrl);

            if (showInBrowser && productUrl) {
                navigateStorefront(productUrl);
            }

            return {
                content: [{ type: 'text', text: formatProductResult(product, showInBrowser) }],
                structuredContent: { lookup: input, product, shownInBrowser: showInBrowser },
            };
        },
    });
}

function formatProductResult(product: ProductSummary, showInBrowser = false): string {
    const opening = showInBrowser && product.url ? `Opening ${product.url} for the shopper.\n` : '';
    const lines = [
        product.name,
        product.price ? `Price: ${product.price}${product.currency ? ` ${product.currency}` : ''}` : null,
        typeof product.available === 'boolean' ? `Available: ${product.available ? 'yes' : 'no'}` : null,
        product.stock !== undefined ? `Stock: ${product.stock}` : null,
        product.productNumber ? `Product number: ${product.productNumber}` : null,
        product.manufacturer ? `Manufacturer: ${product.manufacturer}` : null,
        product.url,
        product.description ? `Description: ${product.description}` : null,
    ].filter(Boolean);

    return `${opening}${lines.join('\n')}`;
}
