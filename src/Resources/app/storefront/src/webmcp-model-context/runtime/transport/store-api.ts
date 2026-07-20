import { cleanText } from '../tools/storefront-tool.utils';
import type { UnknownRecord } from '../types';
import { ACCESS_KEY_HEADER, CONTEXT_TOKEN_HEADER, persistContextToken } from './token-discovery';
import { parseJsonResponse, storeApiErrorMessage } from './http';

const STORE_API_PATH = '/store-api';

/**
 * Thin transport for Shopware's Store API. Owns the context token: each request
 * carries the current token and access key, and a fresh token handed back by the
 * server is captured and persisted so the agent and shopper stay on one session.
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
