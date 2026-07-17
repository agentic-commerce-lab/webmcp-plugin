import { cleanText, isPlainObject, normalizeSameOriginUrl, removeEmptyValues } from '../tools/storefront-tool.utils';
import type { CartSummary, UnknownRecord } from '../types';

export function normalizeCart(cart: any): CartSummary | null {
    if (!isPlainObject(cart)) {
        return null;
    }

    const lineItems = normalizeLineItems(cart.lineItems);

    return removeEmptyValues({
        sessionCartUpdated: cart.sessionCartUpdated,
        cartWidgetRefreshed: cart.cartWidgetRefreshed,
        name: cleanText(cart.name),
        itemCount: lineItems.reduce((count, item) => count + (item.quantity || 0), 0),
        totalPrice: normalizeCartPrice(cart.price),
        lineItems,
    }) as CartSummary;
}

export function normalizeLineItems(collection: any): UnknownRecord[] {
    const items = Array.isArray(collection)
        ? collection
        : isPlainObject(collection?.elements)
          ? Object.values(collection.elements)
          : isPlainObject(collection)
            ? Object.values(collection)
            : [];

    return items
        .map((item) => {
            return removeEmptyValues({
                id: cleanText(item.id),
                referencedId: cleanText(item.referencedId),
                type: cleanText(item.type),
                label: cleanText(item.label),
                quantity: Number.isFinite(item.quantity) ? item.quantity : null,
                price: normalizeCartPrice(item.price),
                payload: normalizeLineItemPayload(item.payload),
            });
        })
        .filter((item) => item.id || item.label);
}

function normalizeCartPrice(price: any): UnknownRecord | null {
    if (!isPlainObject(price)) {
        return null;
    }

    return removeEmptyValues({
        unitPrice: Number.isFinite(price.unitPrice) ? price.unitPrice : null,
        totalPrice: Number.isFinite(price.totalPrice) ? price.totalPrice : null,
        positionPrice: Number.isFinite(price.positionPrice) ? price.positionPrice : null,
        netPrice: Number.isFinite(price.netPrice) ? price.netPrice : null,
    }) as UnknownRecord;
}

function normalizeLineItemPayload(payload: any): UnknownRecord | null {
    if (!isPlainObject(payload)) {
        return null;
    }

    return removeEmptyValues({
        productNumber: cleanText(payload.productNumber),
        parentId: cleanText(payload.parentId),
        optionIds: Array.isArray(payload.optionIds)
            ? payload.optionIds.filter((value: unknown) => cleanText(value))
            : null,
    }) as UnknownRecord;
}

export function findCartLineItemInPayload(cart: any, lineItemId: string): { id: string; quantity: number } | null {
    const lineItems = Array.isArray(cart?.lineItems) ? cart.lineItems : [];

    for (const lineItem of lineItems) {
        const matchedLineItem = findNestedCartLineItem(lineItem, lineItemId);

        if (matchedLineItem) {
            return matchedLineItem;
        }
    }

    return null;
}

function findNestedCartLineItem(lineItem: any, lineItemId: string): { id: string; quantity: number } | null {
    if (!isPlainObject(lineItem)) {
        return null;
    }

    const candidateId = cleanText(lineItem.id);
    const candidateReferencedId = cleanText(lineItem.referencedId);

    if (
        (candidateId === lineItemId || candidateReferencedId === lineItemId) &&
        candidateId &&
        Number.isInteger(lineItem.quantity) &&
        lineItem.quantity > 0
    ) {
        return {
            id: candidateId,
            quantity: lineItem.quantity,
        };
    }

    const children = Array.isArray(lineItem.children) ? lineItem.children : [];

    for (const child of children) {
        const matchedChild = findNestedCartLineItem(child, lineItemId);

        if (matchedChild) {
            return matchedChild;
        }
    }

    return null;
}

export function findCartLineItemInDocument(
    root: Document | Element,
    lineItemId: string,
    baseUrl: string,
): { id: string; quantity: number } | null {
    if (!root || typeof root.querySelectorAll !== 'function') {
        return null;
    }

    const forms = root.querySelectorAll(
        ['form[action*="/checkout/line-item/change-quantity/"]', 'form[action*="/checkout/line-item/delete/"]'].join(
            ',',
        ),
    );

    for (const form of forms) {
        const candidateId = lineItemIdFromFormAction(form, baseUrl);

        if (candidateId !== lineItemId) {
            continue;
        }

        const quantity = readLineItemQuantity(form);

        if (quantity) {
            return {
                id: candidateId,
                quantity,
            };
        }
    }

    return null;
}

function lineItemIdFromFormAction(form: Element, baseUrl: string): string | null {
    const action = cleanText(form.getAttribute?.('action'));
    const url = action ? normalizeSameOriginUrl(action, baseUrl) : null;

    if (!url) {
        return null;
    }

    const path = new URL(url).pathname;
    const lineItemMatch = path.match(/\/checkout\/line-item\/(?:change-quantity|delete)\/([^/]+)(?:\/|$)/i);

    return lineItemMatch ? decodeURIComponent(lineItemMatch[1]) : null;
}

function readLineItemQuantity(form: Element): number | null {
    const formQuantity = readQuantityFromElement(form);

    if (formQuantity) {
        return formQuantity;
    }

    const container = form.closest?.(
        ['[data-line-item-id]', '.cart-item', '.line-item', '.checkout-aside-item'].join(','),
    );

    return container ? readQuantityFromElement(container) : null;
}

function readQuantityFromElement(element: Element): number | null {
    const quantityField = element.querySelector?.(
        [
            'input[name="quantity"]',
            'select[name="quantity"]',
            'input[name$="[quantity]"]',
            'select[name$="[quantity]"]',
            '[data-quantity]',
        ].join(','),
    );
    const rawQuantity =
        (quantityField as HTMLInputElement | HTMLSelectElement | null)?.value ??
        quantityField?.getAttribute?.('value') ??
        quantityField?.getAttribute?.('data-quantity');
    const quantity = Number(rawQuantity);

    return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

export function createAddToCartFormBody({
    productId,
    lineItemId,
    quantity,
}: {
    productId: string;
    lineItemId: string;
    quantity: number;
}): URLSearchParams {
    const body = new URLSearchParams();
    const lineItemPrefix = `lineItems[${lineItemId}]`;

    body.set(`${lineItemPrefix}[id]`, lineItemId);
    body.set(`${lineItemPrefix}[referencedId]`, productId);
    body.set(`${lineItemPrefix}[type]`, 'product');
    body.set(`${lineItemPrefix}[stackable]`, '1');
    body.set(`${lineItemPrefix}[removable]`, '1');
    body.set(`${lineItemPrefix}[quantity]`, String(quantity));

    return body;
}
