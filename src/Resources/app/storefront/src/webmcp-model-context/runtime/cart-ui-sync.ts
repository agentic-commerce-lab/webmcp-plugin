import { refreshCartWidgets } from './cart-ui/widget';
import { openCartOverlay, refreshCartSidebars } from './cart-ui/offcanvas';
import { refreshCartPages } from './cart-ui/cart-page';

export { openCartOverlay };

/**
 * Refreshes the storefront cart UI (header widget, open off-canvas, cart page) after
 * a server-side cart write so the shopper sees the change. The server returns the
 * authoritative cart, so there is nothing to diff here — this is a pure best-effort
 * UI sync across the three surfaces (see `cart-ui/`). Returns whether a cart widget
 * refresh was triggered.
 */
export function refreshCartUi(baseUrl: string): boolean {
    document.dispatchEvent(new CustomEvent('webmcp:cart-updated'));

    const cartWidgetRefreshed = refreshCartWidgets();

    refreshCartSidebars(baseUrl);
    refreshCartPages(baseUrl);

    return cartWidgetRefreshed;
}
