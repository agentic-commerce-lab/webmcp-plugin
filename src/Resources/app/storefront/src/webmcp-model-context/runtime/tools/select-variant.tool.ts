import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { boundedString, MAX_PRODUCT_ID_LENGTH, optionalQuantity } from './schemas';
import type { MatchedVariantSelection } from '../domain/variant';
import type { CartSummary, ProductSummary, StorefrontToolOptions } from '../types';

export const SELECT_VARIANT_TOOL_NAME = 'shopware_webmcp_select_variant';

const MAX_OPTION_NAME_LENGTH = 120;
const MAX_SELECTIONS = 20;

const selectVariantInput = z.object({
    selections: z
        .array(
            z.object({
                group: boundedString(MAX_OPTION_NAME_LENGTH, 'Option group')
                    .describe('Option group name, e.g. "Color" or "Size".')
                    .optional(),
                option: boundedString(MAX_OPTION_NAME_LENGTH, 'Option value').describe(
                    'Option value name, e.g. "red" or "XL".',
                ),
            }),
        )
        .max(MAX_SELECTIONS, `Provide at most ${MAX_SELECTIONS} selections.`)
        .describe('Variant options by name. Prefer this for natural-language picks like red / XL.')
        .optional(),
    optionIds: z
        .array(boundedString(MAX_PRODUCT_ID_LENGTH, 'Option id'))
        .max(MAX_SELECTIONS, `Provide at most ${MAX_SELECTIONS} option ids.`)
        .describe('Variant option ids, if already known (e.g. from get_product options).')
        .optional(),
    quantity: optionalQuantity.describe('Quantity to add when addToCart is true.'),
    addToCart: z
        .boolean()
        .default(true)
        .describe('Add the resolved variant to the cart. Set false to only resolve the variant.'),
    showCartOverlay: z
        .boolean()
        .default(true)
        .describe(
            "Opens the cart overlay after adding so the shopper sees the result. This runs in the shopper's own tab, so keep it true unless a background automation is driving the shop.",
        ),
});

export function createSelectVariantTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: SELECT_VARIANT_TOOL_NAME,
        title: 'Select product variant',
        description:
            'Selects a variant of the product on the current detail page by option names (e.g. Color: red, Size: XL) or option ids, and by default adds it to the cart. Operates on the product being viewed — no product id needed. Use this for requests like "add the red one in XL to my cart".',
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: selectVariantInput,
        execute: async (input) => {
            const result = await shopwareClient.selectVariant(input);

            return {
                content: [{ type: 'text', text: formatResult(result) }],
                structuredContent: {
                    variant: result.variant,
                    selectedOptions: result.selectedOptions,
                    addedToCart: input.addToCart,
                    cart: result.cart,
                },
            };
        },
    });
}

function formatResult(result: {
    variant: ProductSummary;
    selectedOptions: MatchedVariantSelection[];
    cart: CartSummary | null;
}): string {
    const optionSummary = result.selectedOptions
        .map((selection) => `${selection.group ? `${selection.group}: ` : ''}${selection.option}`)
        .join(', ');
    const variantLabel = result.variant.name + (optionSummary ? ` (${optionSummary})` : '');

    if (!result.cart) {
        return `Selected variant ${variantLabel}.`;
    }

    const cartSummary = result.cart.itemCount
        ? ` Cart now has ${result.cart.itemCount} item${result.cart.itemCount === 1 ? '' : 's'}.`
        : '';

    return `Added ${variantLabel} to the cart.${cartSummary}`;
}
