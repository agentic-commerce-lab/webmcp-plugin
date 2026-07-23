/**
 * Single storefront navigation primitive, shared by the `navigate` tool and every tool that
 * shows its result on the page (search, filter, product detail). Callers build the canonical
 * URL (see `domain/listing.ts` `buildListingUrl` and product URLs); this owns the one side
 * effect — assigning `window.location`.
 *
 * The assignment is deferred to the next tick because it unloads the page: the tool must have
 * already produced its result (data + URL) before the browser navigates away.
 */
export function navigateStorefront(url: string): void {
    window.setTimeout(() => {
        window.location.assign(url);
    }, 0);
}
