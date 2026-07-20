import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { hasExactlyOne, optionalQuantity, productSelectorShape } from './schemas';
import type { CartSummary, StorefrontToolOptions } from '../types';

export const ADD_TO_CART_TOOL_NAME = 'shopware_webmcp_add_to_cart';

const addToCartInput = z
    .object({
        ...productSelectorShape,
        quantity: optionalQuantity.describe('Quantity to add.'),
        showCartOverlay: z
            .boolean()
            .default(false)
            .describe(
                "Opens the storefront cart overlay so the shopper immediately sees the product was added. This tool runs inside the shopper's own browser tab, so a person is usually watching — prefer true in normal interactive sessions to give clear visual confirmation. Only set it to false for headless or background automation where nobody is looking at the page.",
            ),
    })
    .refine((value) => hasExactlyOne([value.id, value.sku, value.url]), {
        message: 'Provide exactly one of id, sku, or url.',
    });

type AddToCartInput = z.output<typeof addToCartInput>;

export function createAddToCartTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: ADD_TO_CART_TOOL_NAME,
        title: 'Add to cart',
        description:
            'Adds a product or selected variant to the current cart. Provide exactly one of id, sku, or url. When a shopper is viewing this browser tab (the usual case), also set showCartOverlay to true so they get immediate visual confirmation.',
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: addToCartInput,
        execute: async (input) => {
            const cart = await shopwareClient.addProductToCart(input);

            return {
                content: [{ type: 'text', text: formatAddToCartResult(input, cart) }],
                structuredContent: { added: input, cart },
            };
        },
    });
}

function formatAddToCartResult(input: AddToCartInput, cart: CartSummary | null): string {
    const identifier = input.sku || input.id || input.url;
    const cartSummary = cart?.itemCount
        ? ` Cart now has ${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'}.`
        : '';

    return `Added quantity ${input.quantity} of ${identifier} to cart.${cartSummary}`;
}
