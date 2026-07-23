import { cleanText, isPlainObject, removeEmptyValues } from '../tools/storefront-tool.utils';
import type { CartSummary, UnknownRecord } from '../types';

/**
 * Projects the raw Store API `CartResponse` into the compact, agent-facing cart shape,
 * alongside the product and category normalizers in `domain/`. The raw cart carries no
 * currency, so it is passed in from the runtime config. See ADR 0004.
 *
 * This is a strict allowlist: it deliberately does NOT project the raw cart's `token`
 * (the shopper's per-user context token, present in `cart.json`) nor other server-only
 * fields, so they never reach the tool's `structuredContent` and thus never reach the
 * agent/model. Do not replace this with a raw spread of the cart.
 */
export function normalizeCart(rawCart: any, baseUrl: string, currency: string | null): CartSummary {
    const cart = isPlainObject(rawCart) ? rawCart : {};
    const price = isPlainObject(cart.price) ? cart.price : {};
    const rawLineItems = Array.isArray(cart.lineItems) ? cart.lineItems : [];
    const lineItems = rawLineItems.map((lineItem: any) => normalizeLineItem(lineItem, currency, baseUrl, 0));

    const summary = removeEmptyValues({
        name: cleanText(cart.name),
        currency: currency || undefined,
        cartUrl: `${baseUrl}/checkout/cart`,
        checkoutUrl: `${baseUrl}/checkout/confirm`,
        lineItemCount: lineItems.length,
        itemCount: cartItemCount(lineItems),
        discounts: discountLineItems(lineItems),
        taxes: normalizeCalculatedTaxes(price.calculatedTaxes, currency),
        totals: normalizeCartTotals(cart, price, currency),
    });

    // Always expose lineItems as an array (even when empty) — consumers and the e2e
    // suite rely on `Array.isArray(cart.lineItems)`; removeEmptyValues would drop `[]`.
    summary.lineItems = lineItems;

    return summary as CartSummary;
}

function normalizeLineItem(lineItem: any, currency: string | null, baseUrl: string, level: number): UnknownRecord {
    const item = isPlainObject(lineItem) ? lineItem : {};
    const payload = isPlainObject(item.payload) ? item.payload : {};
    const price = isPlainObject(item.price) ? item.price : null;
    const referencedId = cleanText(item.referencedId);
    const type = cleanText(item.type);
    const children =
        level < 2 && Array.isArray(item.children)
            ? item.children.map((child: any) => normalizeLineItem(child, currency, baseUrl, level + 1))
            : [];

    return removeEmptyValues({
        id: cleanText(item.id),
        referencedId,
        type,
        label: cleanText(item.label),
        quantity: numberValue(item.quantity) ?? undefined,
        good: typeof item.good === 'boolean' ? item.good : undefined,
        productNumber: cleanText(payload.productNumber),
        url: type === 'product' && referencedId ? `${baseUrl}/detail/${referencedId}` : undefined,
        unitPrice: price ? money(price.unitPrice, currency) : undefined,
        totalPrice: price ? money(price.totalPrice, currency) : undefined,
        payload: normalizeLineItemPayload(payload),
        children,
    });
}

function cartItemCount(lineItems: UnknownRecord[]): number {
    let productCount = 0;
    let totalCount = 0;

    for (const lineItem of lineItems) {
        const quantity = numberValue(lineItem.quantity) ?? 0;
        totalCount += quantity;

        if (lineItem.type === 'product') {
            productCount += quantity;
        }
    }

    return productCount > 0 ? productCount : totalCount;
}

function discountLineItems(lineItems: UnknownRecord[]): UnknownRecord[] {
    return lineItems.filter((lineItem) => {
        const type = lineItem.type;
        const totalPrice = isPlainObject(lineItem.totalPrice) ? numberValue(lineItem.totalPrice.value) : null;

        return type === 'discount' || type === 'promotion' || (totalPrice !== null && totalPrice < 0);
    });
}

function normalizeCartTotals(cart: UnknownRecord, price: UnknownRecord, currency: string | null): UnknownRecord {
    const discountTotal = sumFound(asArray(cart.lineItems), (lineItem) => {
        const itemPrice = isPlainObject(lineItem.price) ? numberValue(lineItem.price.totalPrice) : null;

        return itemPrice !== null && itemPrice < 0 ? itemPrice : null;
    });
    const shippingTotal = sumFound(asArray(cart.deliveries), (delivery) => {
        const shippingCosts = isPlainObject(delivery.shippingCosts) ? delivery.shippingCosts : null;

        return shippingCosts ? numberValue(shippingCosts.totalPrice) : null;
    });

    // Compact totals: the net/raw/position duplicates and the derived taxTotal are dropped —
    // agents act on the grand total (plus subtotal/shipping/discount when present).
    return removeEmptyValues({
        subtotal: money(price.positionPrice, currency),
        total: money(price.totalPrice, currency),
        discountTotal: discountTotal !== null ? money(discountTotal, currency) : undefined,
        shippingTotal: shippingTotal !== null ? money(shippingTotal, currency) : undefined,
        taxStatus: cleanText(price.taxStatus),
    });
}

function normalizeCalculatedTaxes(taxes: unknown, currency: string | null): UnknownRecord[] {
    return asArray(taxes).map((tax) =>
        removeEmptyValues({
            tax: money(tax.tax, currency),
            taxRate: numberValue(tax.taxRate) ?? undefined,
            price: money(tax.price, currency),
        }),
    );
}

function normalizeLineItemPayload(payload: UnknownRecord): UnknownRecord {
    return removeEmptyValues({
        productNumber: cleanText(payload.productNumber),
        parentId: cleanText(payload.parentId),
        optionIds: payloadStringList(payload.optionIds),
        options: normalizePayloadOptions(payload.options),
    });
}

function normalizePayloadOptions(options: unknown): UnknownRecord[] {
    return asArray(options)
        .map((option) =>
            removeEmptyValues({
                group: cleanText(option.group),
                option: cleanText(option.option),
            }),
        )
        .filter((option) => Object.keys(option).length > 0);
}

function payloadStringList(value: unknown): string[] {
    return asArray(value)
        .map((item) => cleanText(item))
        .filter((item): item is string => Boolean(item));
}

function money(value: unknown, currency: string | null): { value: number; currency?: string } | undefined {
    const number = numberValue(value);

    if (number === null) {
        return undefined;
    }

    return currency ? { value: number, currency } : { value: number };
}

function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Coerces an unknown value into an array of plain-object records. Store API collections
 * are serialized as arrays; anything else (missing / scalar) yields an empty list.
 */
function asArray(value: unknown): UnknownRecord[] {
    return (Array.isArray(value) ? value : []).filter(isPlainObject);
}

/**
 * Sums a projected value across items, returning `null` when no item contributed — so an
 * absent total is omitted rather than reported as `0` (matching the former PHP builder).
 */
function sumFound(items: UnknownRecord[], project: (item: UnknownRecord) => number | null): number | null {
    let total = 0;
    let found = false;

    for (const item of items) {
        const value = project(item);

        if (value !== null) {
            total += value;
            found = true;
        }
    }

    return found ? total : null;
}
