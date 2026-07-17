import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { hasExactlyOne, lineItemSelectorShape, optionalQuantity } from './schemas';
import type { CartSummary, StorefrontToolOptions } from '../types';

export const REMOVE_FROM_CART_TOOL_NAME = 'shopware_webmcp_remove_from_cart';

const removeFromCartInput = z
    .object({
        ...lineItemSelectorShape,
        quantity: optionalQuantity.describe('Quantity to remove.'),
    })
    .refine((value) => hasExactlyOne([value.lineItemId, value.id, value.sku, value.url]), {
        message: 'Provide exactly one of lineItemId, id, sku, or url.',
    });

type RemoveFromCartInput = z.output<typeof removeFromCartInput>;

export function createRemoveFromCartTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: REMOVE_FROM_CART_TOOL_NAME,
        title: 'Remove from cart',
        description:
            'Removes a product, selected variant, or line item from the current cart. Provide exactly one of lineItemId, id, sku, or url.',
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: removeFromCartInput,
        execute: async (input) => {
            const cart = await shopwareClient.removeProductFromCart(input);

            return {
                content: [{ type: 'text', text: formatRemoveFromCartResult(input, cart) }],
                structuredContent: { removed: input, cart },
            };
        },
    });
}

function formatRemoveFromCartResult(input: RemoveFromCartInput, cart: CartSummary | null): string {
    const identifier = input.lineItemId || input.sku || input.id || input.url;
    const refreshSummary = cart?.cartWidgetRefreshed ? ' Cart widget refresh was requested.' : '';
    const itemCount = cart?.itemCount;
    const cartSummary = Number.isInteger(itemCount)
        ? ` Cart now has ${itemCount} item${itemCount === 1 ? '' : 's'}.`
        : '';

    return `Removed quantity ${input.quantity} of ${identifier} from cart.${cartSummary}${refreshSummary}`;
}
