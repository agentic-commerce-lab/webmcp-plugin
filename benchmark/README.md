# WebMCP Benchmark

Demo benchmark comparing two agent arms on the same Shopware storefront:

- **webmcp** — the agent uses the shop's `document.modelContext` tools
  (`shopware_webmcp_*`), read live from the page.
- **dom** — the agent browses via text snapshots of interactive elements
  plus click/type/select/goto/scroll actions (accessibility-tree style).

Both arms use the same LLM, same prompts, same limits. See
`docs/specs/0004-webmcp-benchmark-concept.md` for the experiment design.

## Setup

```bash
cd benchmark
npm install
npm run setup   # installs Chromium for Playwright
```

Configure the shop and tasks in `src/config.mjs` or via env vars
(`SHOP_BASE_URL`, `CATEGORY_NAME`, `PRODUCT_A_NAME`, ...). All product and
category values must match real data in your demo shop.

Set the LLM (any OpenAI-chat-completions-compatible endpoint):

```bash
export LLM_API_KEY=...
export LLM_MODEL=gpt-4o-mini
# export LLM_BASE_URL=https://...   # optional, for other providers
```

## Run

```bash
node src/run.mjs --arm webmcp --runs 5
node src/run.mjs --arm dom   --runs 5
# subset of tasks:
node src/run.mjs --arm webmcp --tasks open-category,add-variant-to-cart
```

Each run appends one JSON line per task run to `results/*.jsonl` with:
arm, task, steps, timeMs, input/output/peakInput tokens (from API `usage`),
pageBytes (snapshot vs. tool-result payload), success, errorClass.

## Report

```bash
node src/report.mjs
```

Prints a markdown table: median time, steps, tokens, page bytes and success
rate per task x arm.

## Notes

- No WebMCP browser flag is needed: the plugin registers its own
  `document.modelContext` object when the browser has no native support.
  To try a native build, uncomment the flag in `src/browser.mjs`.
- Cart success is checked server-side via `GET /webmcp/cart`, never via the
  agent's self-report.
- Fresh browser context (cookies, cart, session) per task run.
