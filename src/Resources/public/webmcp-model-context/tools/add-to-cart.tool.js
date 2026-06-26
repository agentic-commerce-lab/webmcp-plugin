import { ShopwareClient } from '../shopware-client.js';
import {
    isPlainObject,
    normalizeBaseUrl,
    normalizeOptionalStringField,
} from './storefront-tool.utils.js';

export const ADD_TO_CART_TOOL_NAME = 'shopware_webmcp_add_to_cart';

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
        description: 'Adds a product or selected variant to the current cart.',
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
                    description: 'Product or selected variant ID.',
                },
                sku: {
                    type: 'string',
                    maxLength: MAX_SKU_LENGTH,
                    description: 'Product or selected variant SKU.',
                },
                url: {
                    type: 'string',
                    maxLength: MAX_URL_LENGTH,
                    description: 'Product or selected variant URL.',
                },
                quantity: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_QUANTITY,
                    default: 1,
                    description: 'Quantity to add.',
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

    const id = normalizeOptionalStringField(input.id, MAX_PRODUCT_ID_LENGTH, 'Product id');
    const sku = normalizeOptionalStringField(input.sku, MAX_SKU_LENGTH, 'Product SKU');
    const url = normalizeOptionalStringField(input.url, MAX_URL_LENGTH, 'Product URL');
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
