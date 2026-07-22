import { chromium } from 'playwright';

/**
 * Launches headless Chromium and returns a fresh page for one run.
 *
 * The plugin registers its own document.modelContext object when the
 * browser has no native WebMCP support (see runtime/model-context/registry.ts),
 * so no special browser flags are required. If you want to test against a
 * native implementation, add the flag here.
 *
 * @param {string} baseUrl
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
export async function newSession(baseUrl) {
    const browser = await chromium.launch({
        headless: true,
        args: [
            // Uncomment to try the native WebMCP implementation:
            // '--enable-features=WebMCP',
        ],
    });

    // Fresh context per run: no cookies, no cart, no session.
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();

    return { browser, context, page };
}
