import { ShopwareClient } from '../shopware-client';
import { isPlainObject, normalizeBaseUrl } from './storefront-tool.utils';
import type { CartSummary, StorefrontToolOptions } from '../types';

export const GET_CART_TOOL_NAME = 'shopware_webmcp_get_cart';

export function createGetCartTool(options: StorefrontToolOptions = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const shopwareClient = new ShopwareClient({
        baseUrl,
        accessKey: options.accessKey,
        contextToken: options.contextToken,
    });

    const execute = async (input = {}) => {
        normalizeInput(input);

        const cart = await shopwareClient.getCart();

        return {
            content: [
                {
                    type: 'text',
                    text: formatCartResult(cart),
                },
            ],
            structuredContent: {
                cart,
            },
        };
    };

    return {
        name: GET_CART_TOOL_NAME,
        title: 'Get cart',
        description: 'Returns the current cart.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function normalizeInput(input: unknown): void {
    if (!isPlainObject(input)) {
        throw new Error('Get cart input must be an object.');
    }

    if (Object.keys(input).length > 0) {
        throw new Error('Get cart input does not accept any properties.');
    }
}

function formatCartResult(cart: CartSummary): string {
    const lineItems = Array.isArray(cart?.lineItems) ? cart.lineItems : [];
    const total = formatMoney(cart?.totals?.total || cart?.totalPrice);
    const checkoutUrl = cart?.checkoutUrl ? ` Checkout: ${cart.checkoutUrl}` : '';

    if (lineItems.length === 0) {
        return `Cart is empty.${checkoutUrl}`;
    }

    const itemLines = lineItems.slice(0, 8).map((item, index) => {
        const label = item.label || item.id || `Line item ${index + 1}`;
        const quantity = Number.isFinite(item.quantity) ? ` x ${item.quantity}` : '';
        const price = formatMoney(item.totalPrice);

        return `${index + 1}. ${label}${quantity}${price ? ` - ${price}` : ''}`;
    });
    const remaining =
        lineItems.length > itemLines.length
            ? `\n...and ${lineItems.length - itemLines.length} more line item${lineItems.length - itemLines.length === 1 ? '' : 's'}.`
            : '';

    return `Cart has ${cart.itemCount ?? lineItems.length} item${cart.itemCount === 1 ? '' : 's'}${total ? `, total ${total}` : ''}.${checkoutUrl}\n${itemLines.join('\n')}${remaining}`;
}

function formatMoney(value: unknown): string | null {
    if (!isPlainObject(value) || !Number.isFinite(value.value)) {
        return null;
    }

    return `${value.value}${value.currency ? ` ${value.currency}` : ''}`;
}
