import { z } from 'zod';
import { hasControlCharacters } from './storefront-tool.utils';

export const MAX_PRODUCT_ID_LENGTH = 64;
export const MAX_SKU_LENGTH = 120;
export const MAX_URL_LENGTH = 2048;
export const MAX_LINE_ITEM_ID_LENGTH = 128;
export const MAX_QUANTITY = 100;

/**
 * A trimmed, length-bounded, control-character-free string field. Shared by every
 * tool so the input rules live in one place.
 */
export function boundedString(maxLength: number, label: string) {
    return z
        .string()
        .trim()
        .max(maxLength, `${label} must be ${maxLength} characters or fewer.`)
        .refine((value) => !hasControlCharacters(value), `${label} must not contain control characters.`);
}

/** Product/variant selector fields shared by product and cart tools. */
export const productSelectorShape = {
    id: boundedString(MAX_PRODUCT_ID_LENGTH, 'Product id').describe('Product or selected variant id.').optional(),
    sku: boundedString(MAX_SKU_LENGTH, 'Product SKU').describe('Product or selected variant SKU.').optional(),
    url: boundedString(MAX_URL_LENGTH, 'Product URL').describe('Same-origin product or variant URL.').optional(),
};

/** Cart selector: a line item id in addition to the product selector. */
export const lineItemSelectorShape = {
    lineItemId: boundedString(MAX_LINE_ITEM_ID_LENGTH, 'Cart line item id')
        .describe('Cart line item id. Prefer this when available.')
        .optional(),
    ...productSelectorShape,
};

/** True when exactly one of the given selector values is a non-empty string. */
export function hasExactlyOne(values: Array<string | undefined>): boolean {
    return values.filter((value) => typeof value === 'string' && value.trim() !== '').length === 1;
}

/** Optional quantity, coerced from numeric strings, defaulting to 1 (min 1). */
export const optionalQuantity = z.coerce
    .number()
    .int('Quantity must be an integer.')
    .min(1, 'Quantity must be at least 1.')
    .max(MAX_QUANTITY, `Quantity must be at most ${MAX_QUANTITY}.`)
    .default(1);

/** Required quantity for line-item updates; 0 removes the line item. */
export const lineItemQuantity = z.coerce
    .number()
    .int('Quantity must be an integer.')
    .min(0, 'Quantity must be 0 or greater.')
    .max(MAX_QUANTITY, `Quantity must be at most ${MAX_QUANTITY}.`);
