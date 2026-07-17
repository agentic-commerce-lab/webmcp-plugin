import {
    cleanText,
    fetchStorefrontHtml,
    normalizeSameOriginUrl,
    normalizeUrl,
    parseHtmlDocument,
} from './tools/storefront-tool.utils';
import { STOREFRONT_CART_PATH, STOREFRONT_OFFCANVAS_CART_PATH } from './transport/paths';
import type { UnknownRecord } from './types';

export function publishCartMutation(detail: UnknownRecord, baseUrl: string): boolean {
    document.dispatchEvent(
        new CustomEvent('webmcp:cart-updated', {
            detail,
        }),
    );

    const cartWidgetRefreshed = refreshCartWidgets();

    refreshCartSidebars(baseUrl);
    refreshCartPages(baseUrl);

    return cartWidgetRefreshed;
}

function refreshCartWidgets(): boolean {
    const instances = window.PluginManager?.getPluginInstances?.('CartWidget');
    let refreshed = false;

    if (!instances || typeof instances.forEach !== 'function') {
        return refreshed;
    }

    instances.forEach((instance) => {
        if (!instance || typeof instance.fetch !== 'function') {
            return;
        }

        try {
            const refreshResult = instance.fetch();

            if (refreshResult && typeof refreshResult.catch === 'function') {
                refreshResult.catch(() => {});
            }

            refreshed = true;
        } catch (error) {
            // Cart widget refresh is a best-effort UI sync after the cart mutation succeeds.
        }
    });

    return refreshed;
}

function refreshCartSidebars(baseUrl: string): boolean {
    if (!findOpenCartSidebar()) {
        return false;
    }

    const offCanvasCartUrl = readOffCanvasCartUrl(baseUrl);

    if (!offCanvasCartUrl) {
        return false;
    }

    const refreshed = updateOpenOffCanvasCart(offCanvasCartUrl) || refreshOffCanvasCartPlugins(offCanvasCartUrl);

    if (refreshed) {
        document.dispatchEvent(
            new CustomEvent('webmcp:cart-sidebar-refresh-requested', {
                detail: {
                    url: offCanvasCartUrl,
                },
            }),
        );
    }

    return refreshed;
}

function updateOpenOffCanvasCart(offCanvasCartUrl: string): boolean {
    const instances = getOffCanvasCartInstances();
    const instance = instances.find((candidate) => {
        return typeof candidate._updateOffCanvasContent === 'function';
    });

    if (!instance) {
        return false;
    }

    updateOpenOffCanvasCartContent(instance, offCanvasCartUrl).catch(() => {});

    return true;
}

async function updateOpenOffCanvasCartContent(instance: any, offCanvasCartUrl: string): Promise<void> {
    const html = await fetchStorefrontHtml(new URL(offCanvasCartUrl), 'Cart sidebar refresh');

    if (!findOpenCartSidebar() || typeof instance._updateOffCanvasContent !== 'function') {
        return;
    }

    instance._updateOffCanvasContent(html);
}

function refreshOffCanvasCartPlugins(offCanvasCartUrl: string): boolean {
    const instances = getOffCanvasCartInstances();

    let refreshed = false;

    instances.forEach((instance) => {
        if (refreshed || !instance || typeof instance.openOffCanvas !== 'function') {
            return;
        }

        try {
            instance.openOffCanvas(offCanvasCartUrl, false);
            refreshed = true;
        } catch (error) {
            // Cart sidebar refresh is best-effort after the cart mutation succeeds.
        }
    });

    return refreshed;
}

function getOffCanvasCartInstances(): any[] {
    const instances = window.PluginManager?.getPluginInstances?.('OffCanvasCart');
    const normalizedInstances: any[] = [];

    if (!instances || typeof instances.forEach !== 'function') {
        return normalizedInstances;
    }

    instances.forEach((instance) => {
        if (instance) {
            normalizedInstances.push(instance);
        }
    });

    return normalizedInstances;
}

function findOpenCartSidebar(): Element | null {
    const sidebar = document.querySelector('.offcanvas.cart-offcanvas, .cart-offcanvas');

    return sidebar && isVisibleElement(sidebar) ? sidebar : null;
}

function readOffCanvasCartUrl(baseUrl: string): string | null {
    const configuredUrl = cleanText(window.router?.['frontend.cart.offcanvas']);
    const url = normalizeSameOriginUrl(configuredUrl || STOREFRONT_OFFCANVAS_CART_PATH, baseUrl);

    return url || normalizeUrl(STOREFRONT_OFFCANVAS_CART_PATH, baseUrl);
}

function refreshCartPages(baseUrl: string): boolean {
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

function isVisibleElement(element: Element | null): boolean {
    if (!element || element.closest?.('[aria-hidden="true"], [hidden]')) {
        return false;
    }

    return Boolean((element as HTMLElement).offsetParent || element.getClientRects?.().length);
}
