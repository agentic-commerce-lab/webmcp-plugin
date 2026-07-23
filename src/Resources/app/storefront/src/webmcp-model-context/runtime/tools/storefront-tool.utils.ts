import type { UnknownRecord } from '../types';

export function normalizeBaseUrl(value: unknown): string {
    const fallbackBaseUrl = window.location.origin.replace(/\/+$/, '');

    if (typeof value !== 'string' || value.trim() === '') {
        return fallbackBaseUrl;
    }

    try {
        return new URL(value, fallbackBaseUrl).origin.replace(/\/+$/, '');
    } catch (error) {
        return fallbackBaseUrl;
    }
}

export function normalizeUrl(value: unknown, baseUrl: string): string | null {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    try {
        return new URL(value, baseUrl).toString();
    } catch (error) {
        return null;
    }
}

export function normalizeSameOriginUrl(value: unknown, baseUrl: string): string | null {
    const url = normalizeUrl(value, baseUrl);

    if (!url) {
        return null;
    }

    try {
        const parsedUrl = new URL(url);
        const parsedBaseUrl = new URL(baseUrl);

        return parsedUrl.origin === parsedBaseUrl.origin ? parsedUrl.toString() : null;
    } catch (error) {
        return null;
    }
}

export async function fetchStorefrontHtml(url: URL | string, label = 'Storefront request'): Promise<string> {
    if (typeof fetch !== 'function') {
        throw new Error(`${label} requires the browser fetch API.`);
    }

    const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
            Accept: 'text/html,application/xhtml+xml',
        },
    });

    if (!response.ok) {
        throw new Error(`${label} failed with status ${response.status}.`);
    }

    return response.text();
}

export function parseHtmlDocument(html: string, label = 'HTML parsing'): Document {
    if (typeof DOMParser !== 'function') {
        throw new Error(`${label} requires the browser DOMParser API.`);
    }

    return new DOMParser().parseFromString(html, 'text/html');
}

export function cleanText(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const text = value.replace(/\s+/g, ' ').trim();

    return text || null;
}

/**
 * Strips HTML to plain text so agents read prose, not markup. Uses the browser's parser, which
 * decodes every entity natively (no lossy hand-rolled table). Not a sanitizer. Requires DOMParser
 * — the storefront runtime always has it; a non-browser caller fails loud rather than degrading.
 * Self-contained (no module-scope refs) so the real function can run in a browser via page.evaluate.
 */
export function stripHtml(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    if (typeof DOMParser !== 'function') {
        throw new Error('stripHtml requires the browser DOMParser API.');
    }

    // Space before every tag keeps word boundaries across elements ("shorts.</p><li>Blue"); only ever adds whitespace.
    const doc = new DOMParser().parseFromString(value.replace(/</g, ' <'), 'text/html');
    // textContent would include <script>/<style> source; drop those nodes first.
    doc.querySelectorAll('script, style').forEach((node) => node.remove());

    return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim() || null;
}

// eslint-disable-next-line no-control-regex -- deliberately matches ASCII control characters (C0 range + DEL)
const CONTROL_CHARACTERS = /[\x00-\x1F\x7F]/;

export function hasControlCharacters(value: string): boolean {
    return CONTROL_CHARACTERS.test(value);
}

export function uniqueStrings(values: unknown[]): string[] {
    const seenValues = new Set();
    const normalizedValues: string[] = [];

    values.forEach((value) => {
        const normalizedValue = cleanText(value);

        if (!normalizedValue || seenValues.has(normalizedValue)) {
            return;
        }

        seenValues.add(normalizedValue);
        normalizedValues.push(normalizedValue);
    });

    return normalizedValues;
}

export function isPlainObject(value: unknown): value is UnknownRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function removeEmptyValues(value: UnknownRecord): UnknownRecord {
    return Object.entries(value).reduce((normalizedValue, [key, item]) => {
        if (item === null || typeof item === 'undefined' || item === '') {
            return normalizedValue;
        }

        if (Array.isArray(item) && item.length === 0) {
            return normalizedValue;
        }

        normalizedValue[key] = item;

        return normalizedValue;
    }, {} as UnknownRecord);
}
