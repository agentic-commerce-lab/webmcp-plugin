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
        showResults: z.boolean().default(true).describe('Open the product page (false = data only).'),
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
            "Returns one product's full details (description, gallery, properties, categories) and by default opens its page (showResults:false = data only). Provide exactly one of id, sku, or url.",
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
    // One-line summary; full fields (description, price, stock, …) are in structuredContent.product.
    const price = product.price ? `, ${product.price}${product.currency ? ` ${product.currency}` : ''}` : '';
    const availability =
        typeof product.available === 'boolean' ? ` (${product.available ? 'available' : 'unavailable'})` : '';
    const opened = showInBrowser && product.url ? ' Opened the product page for the shopper.' : '';

    return `${product.name}${price}${availability} (see product).${opened}`;
}
