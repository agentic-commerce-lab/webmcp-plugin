import { cleanText } from '../tools/storefront-tool.utils';
import type { UnknownRecord } from '../types';
import { ACCESS_KEY_HEADER, CONTEXT_TOKEN_HEADER, persistContextToken } from './token-discovery';
import { parseJsonResponse, storeApiErrorMessage } from './http';

const STORE_API_PATH = '/store-api';

/**
 * Thin transport for Shopware's Store API, used for anonymous product/category reads
 * (ADR 0001). It sends the public sales-channel access key and, if the page happens to
 * expose one, a context token; a missing token just yields the default (anonymous)
 * context. The cart does NOT go through here — it uses session-based storefront routes
 * (ADR 0004).
 */
export class StoreApiClient {
    private contextToken: string | null;

    constructor(
        private readonly baseUrl: string,
        private readonly accessKey: string | null,
        contextToken: string | null,
    ) {
        this.contextToken = contextToken;
    }

    async request(path: string, body: UnknownRecord = {}): Promise<unknown> {
        const url = new URL(`${STORE_API_PATH}${path}`, this.baseUrl);
        const headers: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        };

        if (this.accessKey) {
            headers[ACCESS_KEY_HEADER] = this.accessKey;
        }

        if (this.contextToken) {
            headers[CONTEXT_TOKEN_HEADER] = this.contextToken;
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify(body),
        });
        const responseContextToken = cleanText(response.headers.get(CONTEXT_TOKEN_HEADER));

        if (responseContextToken) {
            this.contextToken = responseContextToken;
            persistContextToken(responseContextToken);
        }

        const payload = await parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(storeApiErrorMessage(response, payload));
        }

        return payload;
    }
}
