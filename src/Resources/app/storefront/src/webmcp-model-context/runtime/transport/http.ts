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

export async function parseFlexibleResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (!text) {
        return null;
    }

    if (contentType.includes('application/json')) {
        try {
            return JSON.parse(text);
        } catch (error) {
            return {
                raw: text,
            };
        }
    }

    return {
        raw: text,
    };
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

export function storefrontErrorMessage(response: Response, payload: any): string {
    if (Array.isArray(payload?.errors)) {
        const errorDetail = payload.errors
            .map((error: any) => error.detail || error.title)
            .filter(Boolean)
            .join(' ');

        if (errorDetail) {
            return errorDetail;
        }
    }

    return `Shopware storefront cart request failed with status ${response.status}.`;
}

export function webMcpErrorMessage(response: Response, payload: any): string {
    if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
    }

    return `Shopware WebMCP request failed with status ${response.status}.`;
}
