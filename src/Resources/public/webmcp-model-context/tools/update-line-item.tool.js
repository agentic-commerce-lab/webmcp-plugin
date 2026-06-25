import { ShopwareClient } from '../shopware-client.js';
import {
    isPlainObject,
    normalizeBaseUrl,
    normalizeOptionalStringField,
} from './storefront-tool.utils.js';

export const UPDATE_LINE_ITEM_TOOL_NAME = 'shopware_webmcp_update_line_item';

const MAX_LINE_ITEM_ID_LENGTH = 128;
const MAX_PRODUCT_ID_LENGTH = 64;
const MAX_SKU_LENGTH = 120;
const MAX_URL_LENGTH = 2048;
const MAX_QUANTITY = 100;

export function createUpdateLineItemTool(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const shopwareClient = new ShopwareClient({
        baseUrl,
        accessKey: options.accessKey,
        contextToken: options.contextToken,
    });

    const execute = async (input = {}) => {
        const normalizedInput = normalizeInput(input);

        try {
            const cart = await shopwareClient.updateLineItem(normalizedInput);

            return {
                content: [
                    {
                        type: 'text',
                        text: formatUpdateLineItemResult(normalizedInput, cart),
                    },
                ],
                structuredContent: {
                    updated: normalizedInput,
                    cart,
                },
            };
        } catch (error) {
            if (!isCartLineItemNotFoundError(error)) {
                throw error;
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: formatLineItemNotFoundResult(normalizedInput),
                    },
                ],
                structuredContent: {
                    updated: normalizedInput,
                    skipped: true,
                    reason: 'not_in_cart',
                },
            };
        }
    };

    return {
        name: UPDATE_LINE_ITEM_TOOL_NAME,
        title: 'Update line item',
        description: 'Changes the quantity for a Shopware cart line item by line item id, product id, SKU, or product URL. Product lookups are added to the cart when missing and quantity is greater than 0. Set quantity to 0 to remove the line item.',
        inputSchema: {
            type: 'object',
            required: ['quantity'],
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
                    description: 'Shopware cart line item id, available from get_cart.',
                },
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
                    minimum: 0,
                    maximum: MAX_QUANTITY,
                    description: 'New quantity for the line item. Use 0 to remove it from the cart.',
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
        throw new Error('Update line item input must be an object.');
    }

    const lineItemId = normalizeOptionalStringField(input.lineItemId, MAX_LINE_ITEM_ID_LENGTH, 'Line item id');
    const id = normalizeOptionalStringField(input.id, MAX_PRODUCT_ID_LENGTH, 'Product id');
    const sku = normalizeOptionalStringField(input.sku, MAX_SKU_LENGTH, 'Product SKU');
    const url = normalizeOptionalStringField(input.url, MAX_URL_LENGTH, 'Product URL');
    const providedFields = [lineItemId, id, sku, url].filter(Boolean);

    if (providedFields.length !== 1) {
        throw new Error('Update line item input must include exactly one of lineItemId, id, sku, or url.');
    }

    return {
        ...(lineItemId ? { lineItemId } : {}),
        ...(id ? { id } : {}),
        ...(sku ? { sku } : {}),
        ...(url ? { url } : {}),
        quantity: normalizeQuantity(input.quantity),
    };
}

function normalizeQuantity(value) {
    if (typeof value === 'undefined' || value === null || value === '') {
        throw new Error('Update line item quantity is required.');
    }

    const quantity = typeof value === 'number' ? value : Number(value);

    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
        throw new Error(`Update line item quantity must be an integer between 0 and ${MAX_QUANTITY}.`);
    }

    return quantity;
}

function formatUpdateLineItemResult(input, cart) {
    const identifier = input.lineItemId || input.sku || input.id || input.url;
    const actionSummary = input.quantity === 0
        ? `Removed ${identifier} from cart.`
        : `Set ${identifier} quantity to ${input.quantity}.`;
    const refreshSummary = cart?.cartWidgetRefreshed ? ' Cart widget refresh was requested.' : '';
    const cartSummary = Number.isInteger(cart?.itemCount) ? ` Cart now has ${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'}.` : '';

    return `${actionSummary}${cartSummary}${refreshSummary}`;
}

function formatLineItemNotFoundResult(input) {
    const identifier = input.lineItemId || input.sku || input.id || input.url;

    return `${identifier} is not currently in the cart, so no cart line item was updated. Use a product id, SKU, or URL with quantity greater than 0 to add it.`;
}

function isCartLineItemNotFoundError(error) {
    return error instanceof Error && error.message.startsWith('No cart line item found for ');
}
