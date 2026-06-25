export function normalizeBaseUrl(value) {
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

export function normalizeUrl(value, baseUrl) {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    try {
        return new URL(value, baseUrl).toString();
    } catch (error) {
        return null;
    }
}

export function normalizeSameOriginUrl(value, baseUrl) {
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

export async function fetchStorefrontHtml(url, label = 'Storefront request') {
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

export function parseHtmlDocument(html, label = 'HTML parsing') {
    if (typeof DOMParser !== 'function') {
        throw new Error(`${label} requires the browser DOMParser API.`);
    }

    return new DOMParser().parseFromString(html, 'text/html');
}

export function cleanText(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const text = value.replace(/\s+/g, ' ').trim();

    return text || null;
}

export function uniqueStrings(values) {
    const seenValues = new Set();
    const normalizedValues = [];

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

export function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
