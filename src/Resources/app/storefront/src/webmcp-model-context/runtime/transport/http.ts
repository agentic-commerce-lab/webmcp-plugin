export async function parseJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return {
            raw: text,
        };
    }
}

export function storeApiErrorMessage(response: Response, payload: any): string {
    const errorDetail = Array.isArray(payload?.errors)
        ? payload.errors
              .map((error: any) => error.detail || error.title)
              .filter(Boolean)
              .join(' ')
        : null;

    if (response.status === 401 || response.status === 403) {
        return (
            errorDetail ||
            'Shopware Store API request was rejected. The storefront may need an exposed sw-access-key or valid context token.'
        );
    }

    return errorDetail || `Shopware Store API request failed with status ${response.status}.`;
}

export function webMcpErrorMessage(response: Response, payload: any): string {
    if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
    }

    return `Shopware WebMCP request failed with status ${response.status}.`;
}
