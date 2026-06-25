import { ShopwareClient } from '../shopware-client.js';
import {
    isPlainObject,
    normalizeBaseUrl,
    normalizeOptionalStringField,
} from './storefront-tool.utils.js';

export const REMOVE_FROM_CART_TOOL_NAME = 'shopware.webmcp.remove_from_cart';

const MAX_LINE_ITEM_ID_LENGTH = 128;
const MAX_PRODUCT_ID_LENGTH = 64;
const MAX_SKU_LENGTH = 120;
const MAX_URL_LENGTH = 2048;
const MAX_QUANTITY = 100;

export function createRemoveFromCartTool(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const shopwareClient = new ShopwareClient({
        baseUrl,
        accessKey: options.accessKey,
        contextToken: options.contextToken,
    });

    const execute = async (input = {}) => {
        const normalizedInput = normalizeInput(input);
        const cart = await shopwareClient.removeProductFromCart(normalizedInput);

        return {
            content: [
                {
                    type: 'text',
                    text: formatRemoveFromCartResult(normalizedInput, cart),
                },
            ],
            structuredContent: {
                removed: normalizedInput,
                cart,
            },
        };
    };

    return {
        name: REMOVE_FROM_CART_TOOL_NAME,
        title: 'Remove from cart',
        description: 'Removes a quantity of a product, selected variant, or known line item from the current shopper cart through the Shopware storefront cart endpoint.',
        inputSchema: {
            type: 'object',
            oneOf: [
                { required: ['lineItemId'] },
                { required: ['id'] },
                { required: ['sku'] },
                { required: ['url'] },
            ],
            properties: {
                lineItemId: {
                    type: 'string',
                    maxLength: MAX_LINE_ITEM_ID_LENGTH,
                    description: 'Shopware cart line item id. Prefer this when it is available from cart state.',
                },
                id: {
                    type: 'string',
                    maxLength: MAX_PRODUCT_ID_LENGTH,
                    description: 'Shopware product or selected variant UUID. Used as the product line item id.',
                },
                sku: {
                    type: 'string',
                    maxLength: MAX_SKU_LENGTH,
                    description: 'Product or selected variant SKU/product number. Resolves to the product line item id.',
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
                    description: 'Quantity to remove from the current shopper cart.',
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
        throw new Error('Remove from cart input must be an object.');
    }

    const lineItemId = normalizeOptionalStringField(input.lineItemId, MAX_LINE_ITEM_ID_LENGTH, 'Line item id');
    const id = normalizeOptionalStringField(input.id, MAX_PRODUCT_ID_LENGTH, 'Product id');
    const sku = normalizeOptionalStringField(input.sku, MAX_SKU_LENGTH, 'Product SKU');
    const url = normalizeOptionalStringField(input.url, MAX_URL_LENGTH, 'Product URL');
    const quantity = normalizeQuantity(input.quantity);
    const providedFields = [lineItemId, id, sku, url].filter(Boolean);

    if (providedFields.length !== 1) {
        throw new Error('Remove from cart input must include exactly one of lineItemId, id, sku, or url.');
    }

    return {
        ...(lineItemId ? { lineItemId } : {}),
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
        throw new Error(`Remove from cart quantity must be an integer between 1 and ${MAX_QUANTITY}.`);
    }

    return quantity;
}

function formatRemoveFromCartResult(input, cart) {
    const identifier = input.lineItemId || input.sku || input.id || input.url;
    const refreshSummary = cart?.cartWidgetRefreshed ? ' Cart widget refresh was requested.' : '';
    const cartSummary = Number.isInteger(cart?.itemCount) ? ` Cart now has ${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'}.` : '';

    return `Removed quantity ${input.quantity} of ${identifier} from cart.${cartSummary}${refreshSummary}`;
}
