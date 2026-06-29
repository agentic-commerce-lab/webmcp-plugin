import { mkdir, unlink } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname } from 'node:path';

const sourceFiles = [
    'src/Resources/public/webmcp-model-context.ts',
    'src/Resources/public/webmcp-model-context/shopware-client.ts',
    'src/Resources/public/webmcp-model-context/tools/add-to-cart.tool.ts',
    'src/Resources/public/webmcp-model-context/tools/get-cart.tool.ts',
    'src/Resources/public/webmcp-model-context/tools/get-product.tool.ts',
    'src/Resources/public/webmcp-model-context/tools/get-product-categories.tool.ts',
    'src/Resources/public/webmcp-model-context/tools/navigate.tool.ts',
    'src/Resources/public/webmcp-model-context/tools/remove-from-cart.tool.ts',
    'src/Resources/public/webmcp-model-context/tools/search-products.tool.ts',
    'src/Resources/public/webmcp-model-context/tools/storefront-tool.utils.ts',
    'src/Resources/public/webmcp-model-context/tools/update-line-item.tool.ts',
    'src/Resources/app/storefront/src/main.ts',
    'src/Resources/app/storefront/src/webmcp-model-context/webmcp-model-context.plugin.ts',
];

const transpiler = new Bun.Transpiler({
    loader: 'ts',
    target: 'browser',
});
const shouldClean = Bun.argv.includes('--clean');
const shouldWatch = Bun.argv.includes('--watch');

if (shouldClean) {
    await cleanAll();
} else {
    await buildAll();

    if (shouldWatch) {
        watchSourceFiles();
    }
}

async function buildAll() {
    for (const sourceFile of sourceFiles) {
        await buildFile(sourceFile);
    }

    console.log(`Built ${sourceFiles.length} WebMCP TypeScript file(s).`);
}

async function buildFile(sourceFile: string) {
    const outputFile = generatedFileForSource(sourceFile);
    const sourceCode = await Bun.file(sourceFile).text();
    const outputCode = rewriteTypeScriptImportSpecifiers(transpiler.transformSync(sourceCode, 'ts'));

    await mkdir(dirname(outputFile), { recursive: true });
    await Bun.write(outputFile, ensureTrailingNewline(outputCode));
}

async function cleanAll() {
    let removedFiles = 0;

    for (const sourceFile of sourceFiles) {
        if (await removeGeneratedFile(generatedFileForSource(sourceFile))) {
            removedFiles += 1;
        }
    }

    console.log(`Removed ${removedFiles} generated WebMCP JavaScript file(s).`);
}

async function removeGeneratedFile(outputFile: string) {
    try {
        await unlink(outputFile);

        return true;
    } catch (error) {
        if (isMissingFileError(error)) {
            return false;
        }

        throw error;
    }
}

function watchSourceFiles() {
    let queuedBuild: ReturnType<typeof setTimeout> | null = null;
    const watchers = [];

    for (const sourceFile of sourceFiles) {
        const watcher = watch(sourceFile, () => {
            if (queuedBuild) {
                clearTimeout(queuedBuild);
            }

            queuedBuild = setTimeout(() => {
                buildAll().catch((error) => {
                    console.error(error);
                    process.exitCode = 1;
                });
            }, 100);
        });

        watchers.push(watcher);
    }

    console.log('Watching WebMCP TypeScript source files...');
}

function ensureTrailingNewline(value: string) {
    return value.endsWith('\n') ? value : `${value}\n`;
}

function generatedFileForSource(sourceFile: string) {
    return sourceFile.replace(/\.ts$/, '.js');
}

function rewriteTypeScriptImportSpecifiers(value: string) {
    return value.replace(
        /((?:from\s+|import\s*\(\s*|import\s+)['"])(\.{1,2}\/[^'"]+?)(?:\.ts)?(['"])/g,
        (_match, prefix: string, specifier: string, suffix: string) => {
            if (hasRuntimeExtension(specifier)) {
                return `${prefix}${specifier}${suffix}`;
            }

            return `${prefix}${specifier}.js${suffix}`;
        },
    );
}

function hasRuntimeExtension(specifier: string) {
    return /\.(?:js|mjs|cjs|json|css|svg|png|jpg|jpeg|gif|webp|wasm)$/i.test(specifier);
}

function isMissingFileError(error: unknown) {
    return Boolean(error)
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'ENOENT';
}
