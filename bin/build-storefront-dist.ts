import { rm } from 'node:fs/promises';

declare const Bun: any;

const entrypoint = 'src/Resources/app/storefront/src/main.js';
const outputDirectory = 'src/Resources/app/storefront/dist/storefront/js/swag-web-mcp';

await rm('src/Resources/app/storefront/dist', { recursive: true, force: true });

const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: outputDirectory,
    naming: 'swag-web-mcp.js',
    target: 'browser',
    format: 'iife',
    splitting: false,
    sourcemap: 'none',
    minify: true,
});

if (!result.success) {
    for (const log of result.logs) {
        console.error(log);
    }

    process.exit(1);
}

console.log(`Built Shopware storefront asset: ${outputDirectory}/swag-web-mcp.js`);
