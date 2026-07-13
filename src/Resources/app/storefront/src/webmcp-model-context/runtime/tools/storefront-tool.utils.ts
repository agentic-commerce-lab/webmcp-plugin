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

export function normalizeOptionalStringField(value: unknown, maxLength: number, label: string): string | null {
    if (typeof value === 'undefined' || value === null || value === '') {
        return null;
    }

    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string.`);
    }

    const text = value.trim();

    if (!text) {
        return null;
    }

    if (text.length > maxLength) {
        throw new Error(`${label} must be ${maxLength} characters or fewer.`);
    }

    if (/[\x00-\x1F\x7F]/.test(text)) {
        throw new Error(`${label} must not contain control characters.`);
    }

    return text;
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
