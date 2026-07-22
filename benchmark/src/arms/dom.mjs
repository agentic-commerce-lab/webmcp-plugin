/**
 * Arm B: DOM browsing.
 *
 * The agent sees a compact text snapshot of the page's interactive elements
 * (links, buttons, inputs) plus visible headings, and acts via click / type /
 * select / goto / scroll. This mirrors how accessibility-tree-based browsing
 * agents (playwright-mcp, browser_use, ...) work.
 *
 * Element ids refer to the most recent snapshot only.
 */

const SNAPSHOT_JS = `(() => {
    const candidates = document.querySelectorAll(
        'a[href], button, input, select, textarea, [role="button"], summary'
    );
    const lines = [];
    let id = 0;
    for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden') continue;
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute('type') ? ' type=' + el.getAttribute('type') : '';
        const label = (el.innerText || el.value || el.getAttribute('aria-label')
            || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().slice(0, 80);
        const href = el.getAttribute('href') ? ' href=' + el.getAttribute('href').slice(0, 120) : '';
        const name = el.getAttribute('name') ? ' name=' + el.getAttribute('name') : '';
        lines.push('#' + id + ' <' + tag + type + '> "' + label + '"' + href + name);
        id++;
    }
    const headings = [...document.querySelectorAll('h1, h2, h3, .product-name, .product-title')]
        .map((h) => (h.innerText || '').trim())
        .filter((t) => t.length > 0)
        .slice(0, 40);
    return JSON.stringify({ url: location.href, title: document.title, headings, elements: lines });
})()`;

const tools = [
    {
        type: 'function',
        function: {
            name: 'snapshot',
            description:
                'Get the current page snapshot: URL, headings and a numbered list of interactive elements. Always call this before acting on a new page or after navigation.',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'click',
            description: 'Click element #id from the latest snapshot.',
            parameters: {
                type: 'object',
                properties: { id: { type: 'integer' } },
                required: ['id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'type_text',
            description:
                'Type text into input element #id from the latest snapshot (replaces existing content, submits with Enter if submit=true).',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    text: { type: 'string' },
                    submit: { type: 'boolean' },
                },
                required: ['id', 'text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'select_option',
            description: 'Select an option in a <select> element #id by visible label or value.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    value: { type: 'string' },
                },
                required: ['id', 'value'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'goto',
            description: 'Navigate directly to a URL (absolute or relative to the shop).',
            parameters: {
                type: 'object',
                properties: { url: { type: 'string' } },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'scroll',
            description: 'Scroll the page to reveal more elements.',
            parameters: {
                type: 'object',
                properties: { direction: { type: 'string', enum: ['up', 'down'] } },
                required: ['direction'],
            },
        },
    },
];

/** Resolves the element with the given snapshot id (same enumeration as SNAPSHOT_JS). */
function locatorFor(page, id) {
    return page
        .locator('css=a[href], button, input, select, textarea, [role="button"], summary')
        .filter({ visible: true })
        .nth(id);
}

export function createDomArm(page, ctx) {
    async function executeTool(name, args) {
        let result;

        switch (name) {
            case 'snapshot': {
                result = await page.evaluate(SNAPSHOT_JS);
                break;
            }
            case 'click': {
                const el = locatorFor(page, args.id);
                await Promise.all([page.waitForLoadState('load').catch(() => {}), el.click({ timeout: 5000 })]);
                result = await page.evaluate(SNAPSHOT_JS);
                break;
            }
            case 'type_text': {
                const el = locatorFor(page, args.id);
                await el.fill(String(args.text), { timeout: 5000 });
                if (args.submit) {
                    await Promise.all([page.waitForLoadState('load').catch(() => {}), el.press('Enter')]);
                }
                result = await page.evaluate(SNAPSHOT_JS);
                break;
            }
            case 'select_option': {
                const el = locatorFor(page, args.id);
                await el.selectOption({ label: String(args.value) }).catch(async () => {
                    await el.selectOption(String(args.value));
                });
                result = await page.evaluate(SNAPSHOT_JS);
                break;
            }
            case 'goto': {
                await page.goto(String(args.url), { waitUntil: 'load' });
                result = await page.evaluate(SNAPSHOT_JS);
                break;
            }
            case 'scroll': {
                await page.mouse.wheel(0, args.direction === 'up' ? -800 : 800);
                result = await page.evaluate(SNAPSHOT_JS);
                break;
            }
            default:
                throw new Error(`Unknown DOM action: ${name}`);
        }

        ctx.pageBytes += result.length;
        ctx.toolOutputs.push(result);

        return result;
    }

    return { tools, executeTool };
}
