import { ShopwareClient } from '../shopware-client';
import {
    isPlainObject,
    normalizeBaseUrl,
    normalizeOptionalStringField,
} from './storefront-tool.utils';
import type { CartQuantityInput, CartSummary, StorefrontToolOptions } from '../types';

export const REMOVE_FROM_CART_TOOL_NAME = 'shopware_webmcp_remove_from_cart';

const MAX_LINE_ITEM_ID_LENGTH = 128;
const MAX_PRODUCT_ID_LENGTH = 64;
const MAX_SKU_LENGTH = 120;
const MAX_URL_LENGTH = 2048;
const MAX_QUANTITY = 100;

export function createRemoveFromCartTool(options: StorefrontToolOptions = {}) {
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
        description: 'Removes a product, selected variant, or line item from the current cart.',
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
                    description: 'Cart line item ID. Prefer this when available.',
                },
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
                    description: 'Quantity to remove.',
                },
            },
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function normalizeInput(input: unknown): CartQuantityInput {
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

function normalizeQuantity(value: unknown): number {
    if (typeof value === 'undefined' || value === null) {
        return 1;
    }

    const quantity = typeof value === 'number' ? value : Number(value);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
        throw new Error(`Remove from cart quantity must be an integer between 1 and ${MAX_QUANTITY}.`);
    }

    return quantity;
}

function formatRemoveFromCartResult(input: CartQuantityInput, cart: CartSummary | null): string {
    const identifier = input.lineItemId || input.sku || input.id || input.url;
    const refreshSummary = cart?.cartWidgetRefreshed ? ' Cart widget refresh was requested.' : '';
    const itemCount = cart?.itemCount;
    const cartSummary = Number.isInteger(itemCount) ? ` Cart now has ${itemCount} item${itemCount === 1 ? '' : 's'}.` : '';

    return `Removed quantity ${input.quantity} of ${identifier} from cart.${cartSummary}${refreshSummary}`;
}
