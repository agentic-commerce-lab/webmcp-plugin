/**
 * Refreshes the Shopware header cart widget after a cart write. Best-effort:
 * returns whether a refresh was triggered on at least one widget instance.
 */
export function refreshCartWidgets(): boolean {
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
