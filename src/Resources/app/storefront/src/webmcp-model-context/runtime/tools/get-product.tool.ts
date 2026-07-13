import { ShopwareClient } from '../shopware-client';
import {
    isPlainObject,
    normalizeBaseUrl,
    normalizeOptionalStringField,
} from './storefront-tool.utils';
import type { ProductLookupInput, ProductSummary, StorefrontToolOptions } from '../types';

export const GET_PRODUCT_TOOL_NAME = 'shopware_webmcp_get_product';

const MAX_PRODUCT_ID_LENGTH = 64;
const MAX_SKU_LENGTH = 120;
const MAX_URL_LENGTH = 2048;

export function createGetProductTool(options: StorefrontToolOptions = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const shopwareClient = new ShopwareClient({
        baseUrl,
        accessKey: options.accessKey,
        contextToken: options.contextToken,
    });

    const execute = async (input = {}) => {
        const normalizedInput = normalizeInput(input);
        const product = await shopwareClient.getProduct(normalizedInput);

        return {
            content: [
                {
                    type: 'text',
                    text: formatProductResult(product),
                },
            ],
            structuredContent: {
                lookup: normalizedInput,
                product,
            },
        };
    };

    return {
        name: GET_PRODUCT_TOOL_NAME,
        title: 'Get product',
        description: 'Returns product details.',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    maxLength: MAX_PRODUCT_ID_LENGTH,
                    description: 'Product ID.',
                },
                sku: {
                    type: 'string',
                    maxLength: MAX_SKU_LENGTH,
                    description: 'Product SKU.',
                },
                url: {
                    type: 'string',
                    maxLength: MAX_URL_LENGTH,
                    description: 'Product URL.',
                },
            },
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function normalizeInput(input: unknown): ProductLookupInput {
    if (!isPlainObject(input)) {
        throw new Error('Get product input must be an object.');
    }

    const id = normalizeOptionalStringField(input.id, MAX_PRODUCT_ID_LENGTH, 'Product id');
    const sku = normalizeOptionalStringField(input.sku, MAX_SKU_LENGTH, 'Product SKU');
    const url = normalizeOptionalStringField(input.url, MAX_URL_LENGTH, 'Product URL');
    const providedFields = [id, sku, url].filter(Boolean);

    if (providedFields.length !== 1) {
        throw new Error('Get product input must include exactly one of id, sku, or url.');
    }

    return {
        ...(id ? { id } : {}),
        ...(sku ? { sku } : {}),
        ...(url ? { url } : {}),
    };
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
