import { ShopwareClient } from '../shopware-client.js';
import {
    isPlainObject,
    normalizeBaseUrl,
} from './storefront-tool.utils.js';

export const ADD_TO_CART_TOOL_NAME = 'shopware.webmcp.add_to_cart';

const MAX_PRODUCT_ID_LENGTH = 64;
const MAX_SKU_LENGTH = 120;
const MAX_URL_LENGTH = 2048;
const MAX_QUANTITY = 100;

export function createAddToCartTool(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const shopwareClient = new ShopwareClient({
        baseUrl,
        accessKey: options.accessKey,
        contextToken: options.contextToken,
    });

    const execute = async (input = {}) => {
        const normalizedInput = normalizeInput(input);
        const cart = await shopwareClient.addProductToCart(normalizedInput);

        return {
            content: [
                {
                    type: 'text',
                    text: formatAddToCartResult(normalizedInput, cart),
                },
            ],
            structuredContent: {
                added: normalizedInput,
                cart,
            },
        };
    };

    return {
        name: ADD_TO_CART_TOOL_NAME,
        title: 'Add to cart',
        description: 'Adds a product or selected variant to the current shopper cart through the Shopware storefront cart endpoint.',
        inputSchema: {
            type: 'object',
            oneOf: [
                { required: ['id'] },
                { required: ['sku'] },
                { required: ['url'] },
            ],
            properties: {
                id: {
                    type: 'string',
                    maxLength: MAX_PRODUCT_ID_LENGTH,
                    description: 'Shopware product or selected variant UUID.',
                },
                sku: {
                    type: 'string',
                    maxLength: MAX_SKU_LENGTH,
                    description: 'Product or selected variant SKU/product number.',
                },
                url: {
                    type: 'string',
                    maxLength: MAX_URL_LENGTH,
                    description: 'Same-origin /detail/{id} product or selected variant URL/path.',
                },
                quantity: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_QUANTITY,
                    default: 1,
                    description: 'Quantity to add to the current shopper cart.',
                },
            },
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function normalizeInput(input) {
    if (!isPlainObject(input)) {
        throw new Error('Add to cart input must be an object.');
    }

    const id = normalizeOptionalText(input.id, MAX_PRODUCT_ID_LENGTH, 'Product id');
    const sku = normalizeOptionalText(input.sku, MAX_SKU_LENGTH, 'Product SKU');
    const url = normalizeOptionalText(input.url, MAX_URL_LENGTH, 'Product URL');
    const quantity = normalizeQuantity(input.quantity);
    const providedFields = [id, sku, url].filter(Boolean);

    if (providedFields.length !== 1) {
        throw new Error('Add to cart input must include exactly one of id, sku, or url.');
    }

    return {
        ...(id ? { id } : {}),
        ...(sku ? { sku } : {}),
        ...(url ? { url } : {}),
        quantity,
    };
}

function normalizeOptionalText(value, maxLength, label) {
    if (typeof value === 'undefined' || value === null || value === '') {
        return null;
    }

    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string.`);
    }

    const text = value.trim();

    if (!text) {
        return null;
    }

    if (text.length > maxLength) {
        throw new Error(`${label} must be ${maxLength} characters or fewer.`);
    }

    if (/[\x00-\x1F\x7F]/.test(text)) {
        throw new Error(`${label} must not contain control characters.`);
    }

    return text;
}

function normalizeQuantity(value) {
    if (typeof value === 'undefined' || value === null) {
        return 1;
    }

    const quantity = typeof value === 'number' ? value : Number(value);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
        throw new Error(`Add to cart quantity must be an integer between 1 and ${MAX_QUANTITY}.`);
    }

    return quantity;
}

function formatAddToCartResult(input, cart) {
    const identifier = input.sku || input.id || input.url;
    const cartSummary = cart?.itemCount ? ` Cart now has ${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'}.` : '';

    return `Added quantity ${input.quantity} of ${identifier} to cart.${cartSummary}`;
}
