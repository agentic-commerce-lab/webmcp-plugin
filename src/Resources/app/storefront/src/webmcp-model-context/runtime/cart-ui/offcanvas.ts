import { cleanText, fetchStorefrontHtml, normalizeSameOriginUrl, normalizeUrl } from '../tools/storefront-tool.utils';
import { STOREFRONT_OFFCANVAS_CART_PATH } from '../transport/paths';

/**
 * Actively opens the Shopware off-canvas cart overlay, giving the shopper direct
 * visual feedback after an agent-driven cart change. Opt-in per call (see the
 * add_to_cart `showCartOverlay` param): a background agent operating the shop
 * invisibly does not open it.
 */
export function openCartOverlay(baseUrl: string): boolean {
    const offCanvasCartUrl = readOffCanvasCartUrl(baseUrl);

    if (!offCanvasCartUrl) {
        return false;
    }

    const opened = refreshOffCanvasCartPlugins(offCanvasCartUrl);

    if (opened) {
        document.dispatchEvent(
            new CustomEvent('webmcp:cart-overlay-opened', {
                detail: {
                    url: offCanvasCartUrl,
                },
            }),
        );
    }

    return opened;
}

/**
 * Refreshes an already-open off-canvas cart sidebar so its contents match the
 * server cart after a write. Returns whether a refresh was triggered.
 */
export function refreshCartSidebars(baseUrl: string): boolean {
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

function isVisibleElement(element: Element | null): boolean {
    if (!element || element.closest?.('[aria-hidden="true"], [hidden]')) {
        return false;
    }

    return Boolean((element as HTMLElement).offsetParent || element.getClientRects?.().length);
}
