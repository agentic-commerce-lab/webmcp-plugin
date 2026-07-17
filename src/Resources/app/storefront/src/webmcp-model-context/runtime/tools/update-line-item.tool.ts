import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { hasExactlyOne, lineItemQuantity, lineItemSelectorShape } from './schemas';
import type { CartSummary, StorefrontToolOptions } from '../types';

export const UPDATE_LINE_ITEM_TOOL_NAME = 'shopware_webmcp_update_line_item';

const updateLineItemInput = z
    .object({
        ...lineItemSelectorShape,
        quantity: lineItemQuantity.describe('New quantity for the line item. Use 0 to remove it from the cart.'),
    })
    .refine((value) => hasExactlyOne([value.lineItemId, value.id, value.sku, value.url]), {
        message: 'Provide exactly one of lineItemId, id, sku, or url.',
    });

type UpdateLineItemInput = z.output<typeof updateLineItemInput>;

export function createUpdateLineItemTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: UPDATE_LINE_ITEM_TOOL_NAME,
        title: 'Update line item',
        description:
            'Sets the cart quantity for a line item or product. Provide exactly one of lineItemId, id, sku, or url.',
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: updateLineItemInput,
        execute: async (input) => {
            try {
                const cart = await shopwareClient.updateLineItem(input);

                return {
                    content: [{ type: 'text', text: formatUpdateLineItemResult(input, cart) }],
                    structuredContent: { updated: input, cart },
                };
            } catch (error) {
                if (!isCartLineItemNotFoundError(error)) {
                    throw error;
                }

                return {
                    content: [{ type: 'text', text: formatLineItemNotFoundResult(input) }],
                    structuredContent: { updated: input, skipped: true, reason: 'not_in_cart' },
                };
            }
        },
    });
}

function formatUpdateLineItemResult(input: UpdateLineItemInput, cart: CartSummary | null): string {
    const identifier = input.lineItemId || input.sku || input.id || input.url;
    const actionSummary =
        input.quantity === 0 ? `Removed ${identifier} from cart.` : `Set ${identifier} quantity to ${input.quantity}.`;
    const refreshSummary = cart?.cartWidgetRefreshed ? ' Cart widget refresh was requested.' : '';
    const itemCount = cart?.itemCount;
    const cartSummary = Number.isInteger(itemCount)
        ? ` Cart now has ${itemCount} item${itemCount === 1 ? '' : 's'}.`
        : '';

    return `${actionSummary}${cartSummary}${refreshSummary}`;
}

function formatLineItemNotFoundResult(input: UpdateLineItemInput): string {
    const identifier = input.lineItemId || input.sku || input.id || input.url;

    return `${identifier} is not currently in the cart, so no cart line item was updated. Use a product id, SKU, or URL with quantity greater than 0 to add it.`;
}

function isCartLineItemNotFoundError(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith('No cart line item found for ');
}
