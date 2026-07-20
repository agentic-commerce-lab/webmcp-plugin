import { fetchStorefrontHtml, normalizeUrl, parseHtmlDocument } from '../tools/storefront-tool.utils';
import { STOREFRONT_CART_PATH } from '../transport/paths';

/**
 * Refreshes the cart page fragment in place when the shopper is currently on the
 * cart page, so a cart write is reflected without a full reload. Dispatches a
 * cancelable event first so a theme can opt out. Returns whether a refresh ran.
 */
export function refreshCartPages(baseUrl: string): boolean {
    if (!isCurrentCartPage()) {
        return false;
    }

    const refreshEvent = new CustomEvent('webmcp:cart-page-refresh-requested', {
        cancelable: true,
        detail: {
            url: normalizeUrl(STOREFRONT_CART_PATH, baseUrl),
            targetSelector: '.checkout',
        },
    });

    if (!document.dispatchEvent(refreshEvent)) {
        return false;
    }

    refreshCartPage(baseUrl).catch(() => {});

    return true;
}

async function refreshCartPage(baseUrl: string): Promise<void> {
    const html = await fetchStorefrontHtml(new URL(STOREFRONT_CART_PATH, baseUrl), 'Cart page refresh');

    if (!isCurrentCartPage()) {
        return;
    }

    const cartDocument = parseHtmlDocument(html, 'Cart page refresh');
    const refreshedElement = replaceCartPageElement(cartDocument);

    if (!refreshedElement) {
        return;
    }

    initializeShopwarePlugins(refreshedElement);

    document.dispatchEvent(
        new CustomEvent('webmcp:cart-page-refreshed', {
            detail: {
                element: refreshedElement,
            },
        }),
    );
}

function isCurrentCartPage(): boolean {
    const path = window.location?.pathname || '';

    if (/\/checkout\/cart\/?$/i.test(path)) {
        return true;
    }

    const bodyClassList = document.body?.classList;

    if (bodyClassList?.contains('is-ctl-checkout') && bodyClassList.contains('is-act-cart')) {
        return true;
    }

    return false;
}

function replaceCartPageElement(cartDocument: Document): Element | null {
    const currentElement = document.querySelector('.checkout');
    const freshElement = cartDocument.querySelector('.checkout');

    if (!currentElement || !freshElement) {
        return null;
    }

    const replacement = freshElement.cloneNode(true) as Element;

    currentElement.replaceWith(replacement);

    return replacement;
}

function initializeShopwarePlugins(parentElement: Element): void {
    const pluginManager = window.PluginManager;

    try {
        if (parentElement && typeof pluginManager?.initializePluginsInParentElement === 'function') {
            const result = pluginManager.initializePluginsInParentElement(parentElement);

            if (result && typeof (result as Promise<unknown>).catch === 'function') {
                (result as Promise<unknown>).catch(() => {});
            }

            return;
        }

        const result = pluginManager?.initializePlugins?.();

        if (result && typeof (result as Promise<unknown>).catch === 'function') {
            (result as Promise<unknown>).catch(() => {});
        }
    } catch (error) {
        // Cart page fragment plugin initialization is best-effort after the rendered HTML is replaced.
    }
}
