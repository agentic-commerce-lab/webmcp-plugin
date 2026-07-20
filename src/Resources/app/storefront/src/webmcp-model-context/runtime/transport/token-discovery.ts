import { cleanText } from '../tools/storefront-tool.utils';

export const CONTEXT_TOKEN_HEADER = 'sw-context-token';
export const ACCESS_KEY_HEADER = 'sw-access-key';
export const CONTEXT_TOKEN_STORAGE_KEY = 'sw-context-token';

export function readContextToken(): string | null {
    return readKnownValue([
        () => readMetaContent('sw-context-token'),
        () => readStorageValue(CONTEXT_TOKEN_STORAGE_KEY),
        () => readStorageValue('swContextToken'),
        () => readCookieValue(CONTEXT_TOKEN_STORAGE_KEY),
        () => readCookieValue('sw_context_token'),
    ]);
}

export function readAccessKey(): string | null {
    return readKnownValue([
        () => readMetaContent('sw-access-key'),
        () => readMetaContent('shopware-store-api-access-key'),
        () => window?.storefrontSettings?.storeApi?.accessKey,
        () => window?.storefrontSettings?.salesChannel?.accessKey,
        () => window?.Shopware?.StoreApi?.accessKey,
        () => window?.Shopware?.Context?.accessKey,
        () => window?.swAccessKey,
    ]);
}

function readKnownValue(readers: Array<() => unknown>): string | null {
    for (const reader of readers) {
        try {
            const value = cleanText(reader());

            if (value) {
                return value;
            }
        } catch (error) {
            // Ignore inaccessible browser storage.
        }
    }

    return null;
}

function readMetaContent(name: string): string | null {
    return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
}

function readStorageValue(key: string): string | null {
    return window.localStorage?.getItem(key) || window.sessionStorage?.getItem(key) || null;
}

function readCookieValue(name: string): string | null {
    const encodedName = `${encodeURIComponent(name)}=`;
    const cookie = document.cookie
        .split(';')
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(encodedName));

    return cookie ? decodeURIComponent(cookie.slice(encodedName.length)) : null;
}

export function persistContextToken(contextToken: string): void {
    try {
        window.localStorage?.setItem(CONTEXT_TOKEN_STORAGE_KEY, contextToken);
    } catch (error) {
        // Ignore inaccessible browser storage.
    }
}
