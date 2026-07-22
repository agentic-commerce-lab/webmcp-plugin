import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { isPlainObject } from './storefront-tool.utils';
import type { StorefrontToolOptions, UnknownRecord } from '../types';

export const GET_SALES_CHANNEL_CONTEXT_TOOL_NAME = 'shopware_webmcp_get_sales_channel_context';

const getSalesChannelContextInput = z.strictObject({});

export function createGetSalesChannelContextTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: GET_SALES_CHANNEL_CONTEXT_TOOL_NAME,
        title: 'Get sales channel context',
        description:
            'Returns the active sales channel context: channel, language, currency, customer group, country, tax mode, login state.',
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        input: getSalesChannelContextInput,
        execute: async () => {
            const context = await shopwareClient.getSalesChannelContext();

            return {
                content: [{ type: 'text', text: formatContext(context) }],
                structuredContent: { salesChannelContext: context },
            };
        },
    });
}

function formatContext(context: UnknownRecord): string {
    const parts: string[] = [];
    const salesChannel = isPlainObject(context.salesChannel) ? context.salesChannel : null;
    const currency = isPlainObject(context.currency) ? context.currency : null;
    const customerGroup = isPlainObject(context.customerGroup) ? context.customerGroup : null;
    const country = isPlainObject(context.country) ? context.country : null;
    const customer = isPlainObject(context.customer) ? context.customer : null;

    if (salesChannel?.name) {
        parts.push(`Sales channel: ${salesChannel.name}`);
    }

    if (currency?.isoCode) {
        parts.push(`currency ${currency.isoCode}`);
    }

    if (customerGroup?.name) {
        parts.push(`customer group ${customerGroup.name}`);
    }

    if (country?.iso) {
        parts.push(`country ${country.iso}`);
    }

    if (typeof context.taxState === 'string') {
        parts.push(`prices ${context.taxState}`);
    }

    parts.push(customer?.loggedIn ? 'customer logged in' : 'guest');

    return parts.length > 0 ? `${parts.join(', ')}.` : 'Sales channel context is available.';
}
