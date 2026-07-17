import { defineConfig, devices } from '@playwright/test';

/**
 * WebMCP integration tests run against a real, running Shopware storefront.
 *
 * - Locally: defaults to the developer's running shopware-cli project.
 * - In CI: point SHOPWARE_BASE_URL at the Dockware container (see ADR 0003).
 *
 * The plugin must be installed and active in the target shop, otherwise the
 * `document.modelContext` tools are never registered.
 */
const baseURL = process.env.SHOPWARE_BASE_URL ?? 'http://127.0.0.1:8000';

export default defineConfig({
    testDir: './tests/e2e',
    // The tools hit the Store API / cart routes of a real shop; give them room.
    timeout: 60_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL,
        trace: 'on-first-retry',
        video: 'retain-on-failure',
        // Demo shops commonly run with self-signed certs behind a proxy.
        ignoreHTTPSErrors: true,
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
