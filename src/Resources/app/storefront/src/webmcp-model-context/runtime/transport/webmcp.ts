import { parseJsonResponse, webMcpErrorMessage } from './http';

interface WebMcpRequestOptions {
    method?: 'GET' | 'POST' | 'PATCH';
    body?: unknown;
}

/**
 * Transport for the plugin's own same-origin `/webmcp` endpoints. These ride the
 * shopper's session cookie (no access-key / context-token header) and are never
 * cached; the write variants send a JSON body.
 */
export async function webMcpRequest(url: string, options: WebMcpRequestOptions = {}): Promise<unknown> {
    const hasBody = options.body !== undefined;
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
    };

    if (hasBody) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
        method: options.method ?? 'GET',
        credentials: 'same-origin',
        headers,
        ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(webMcpErrorMessage(response, payload));
    }

    return payload;
}
