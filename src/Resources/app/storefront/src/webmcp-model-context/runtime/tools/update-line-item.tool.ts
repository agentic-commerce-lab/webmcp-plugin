import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { hasExactlyOne, lineItemQuantity, productSelectorShape } from './schemas';
import type { CartSummary, StorefrontToolOptions } from '../types';

export const UPDATE_LINE_ITEM_TOOL_NAME = 'shopware_webmcp_update_line_item';

const updateLineItemInput = z
    .object({
        ...productSelectorShape,
        quantity: lineItemQuantity.describe(
            'Target quantity for this product in the cart. Use 0 to remove it. Adds the product if it is not in the cart yet.',
        ),
    })
    .refine((value) => hasExactlyOne([value.id, value.sku, value.url]), {
        message: 'Provide exactly one of id, sku, or url.',
    });

type UpdateLineItemInput = z.output<typeof updateLineItemInput>;

export function createUpdateLineItemTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: UPDATE_LINE_ITEM_TOOL_NAME,
        title: 'Update line item',
        description:
            'Sets the cart quantity for a product to an exact target (declarative and idempotent). Use quantity 0 to remove it; the product is added if it is not in the cart yet. Provide exactly one of id, sku, or url.',
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: updateLineItemInput,
        execute: async (input) => {
            const cart = await shopwareClient.updateLineItem(input);

            return {
                content: [{ type: 'text', text: formatUpdateLineItemResult(input, cart) }],
                structuredContent: { updated: input, cart },
            };
        },
    });
}

function formatUpdateLineItemResult(input: UpdateLineItemInput, cart: CartSummary | null): string {
    const identifier = input.sku || input.id || input.url;
    const actionSummary =
        input.quantity === 0 ? `Removed ${identifier} from cart.` : `Set ${identifier} quantity to ${input.quantity}.`;
    const itemCount = cart?.itemCount;
    const cartSummary = Number.isInteger(itemCount)
        ? ` Cart now has ${itemCount} item${itemCount === 1 ? '' : 's'}.`
        : '';

    return `${actionSummary}${cartSummary}`;
}
