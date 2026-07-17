import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { hasExactlyOne, productSelectorShape } from './schemas';
import type { ProductSummary, StorefrontToolOptions } from '../types';

export const GET_PRODUCT_TOOL_NAME = 'shopware_webmcp_get_product';

const getProductInput = z
    .object({ ...productSelectorShape })
    .refine((value) => hasExactlyOne([value.id, value.sku, value.url]), {
        message: 'Provide exactly one of id, sku, or url.',
    });

export function createGetProductTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: GET_PRODUCT_TOOL_NAME,
        title: 'Get product',
        description: 'Returns product details. Provide exactly one of id, sku, or url.',
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        input: getProductInput,
        execute: async (input) => {
            const product = await shopwareClient.getProduct(input);

            return {
                content: [{ type: 'text', text: formatProductResult(product) }],
                structuredContent: { lookup: input, product },
            };
        },
    });
}

function formatProductResult(product: ProductSummary): string {
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

    return lines.join('\n');
}
