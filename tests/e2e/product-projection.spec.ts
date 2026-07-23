import { expect, test } from '@playwright/test';
import { stripHtml } from '../../src/Resources/app/storefront/src/webmcp-model-context/runtime/tools/storefront-tool.utils';
import { toListingItem } from '../../src/Resources/app/storefront/src/webmcp-model-context/runtime/domain/product';
import type { ProductSummary } from '../../src/Resources/app/storefront/src/webmcp-model-context/runtime/types';

/**
 * Unit tests for the product projection. `toListingItem` runs in node; `stripHtml` needs the
 * browser's DOMParser, so we run the real source in Chromium via page.evaluate — no shop required.
 */

/** Run the real stripHtml source in the browser, where DOMParser lives. */
async function stripHtmlInBrowser(page: import('@playwright/test').Page, html: unknown): Promise<string | null> {
    return page.evaluate(stripHtml, html as string);
}

test('stripHtml turns rich-text markup into readable plain text', async ({ page }) => {
    const html = '<p>Soft <strong>cotton</strong> tee &amp; shorts.</p><ul><li>Blue</li></ul>';

    expect(await stripHtmlInBrowser(page, html)).toBe('Soft cotton tee & shorts. Blue');
});

test('stripHtml decodes named, numeric and hex entities without losing text', async ({ page }) => {
    // The exact failure mode of a hand-rolled strip: German umlauts, em-dash, euro sign.
    const html = 'M&uuml;ller&mdash;Preis &#8364;5 &#x20AC;10 &lt; &#x1F600;';

    expect(await stripHtmlInBrowser(page, html)).toBe('Müller—Preis €5 €10 < 😀');
});

test('stripHtml keeps literal angle brackets in text intact', async ({ page }) => {
    // A regex tag strip would eat "< x >"; the HTML parser leaves plain text alone.
    expect(await stripHtmlInBrowser(page, 'Größe 5 < x > 3')).toBe('Größe 5 < x > 3');
});

test('stripHtml drops script/style bodies', async ({ page }) => {
    const html = '<style>.x{color:red}</style>Hello<script>evil()</script>World';

    expect(await stripHtmlInBrowser(page, html)).toBe('Hello World');
});

test('stripHtml passes non-strings through as null', async ({ page }) => {
    expect(await stripHtmlInBrowser(page, null)).toBeNull();
    expect(await stripHtmlInBrowser(page, undefined)).toBeNull();
});

test('listing projection omits the description', () => {
    const product = {
        id: 'p1',
        name: 'Cotton Tee',
        description: 'A long marketing description that listings must not carry.',
        price: '19.99',
    } as unknown as ProductSummary;

    const card = toListingItem(product) as Record<string, unknown>;

    expect(card).not.toHaveProperty('description');
    // Essentials the agent still needs stay on the card.
    expect(card.id).toBe('p1');
    expect(card.name).toBe('Cotton Tee');
});
