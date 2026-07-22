# Benchmark Concept: WebMCP-Enabled Agent vs. DOM-Browsing Agent

Date: 2026-07-22
Status: Draft

## Goal

Produce a reproducible, demo-able comparison that answers one question for a
talk/blog post: **"Is an agent that uses WebMCP tools faster, cheaper, and
more reliable than an agent that has to read and click its way through the
storefront?"**

The output should be a small table + a headline number ("x% fewer tokens",
"y% faster", "z% fewer failed tasks"), plus the raw run logs to back it up.

## Context

- The plugin exposes 12 runtime tools via `document.modelContext`, all
  prefixed `shopware_webmcp_*`: `get_product_categories`,
  `search_products`, `filter_products`, `get_listing_filters`,
  `get_product`, `select_variant`, `navigate`, `get_cart`, `add_to_cart`,
  `update_line_item`, `clear_cart`, `get_sales_channel_context`.
- No agentic browser ships WebMCP support yet. We therefore drive a headless
  Chromium (with the WebMCP origin-trial / experimental flag, or by simply
  injecting a `document.modelContext` polyfill/shim if the flag is
  unavailable) from a simple scripted "agent harness" that exposes the tools
  to an LLM as function calls.
- For the control arm, the same LLM and the same browser operate without
  tools and must navigate via DOM snapshot + synthetic clicks/typing
  (Playwright-style accessibility-tree interaction).

## Experimental Design

### Two arms, one harness

```
                ┌──────────────────────────────┐
   task prompt  │  LLM agent loop (same model, │
   ───────────▶ │  same temperature, same max  │
                │  steps)                      │
                └──────┬───────────────┬───────┘
                       │               │
              Arm A: WebMCP     Arm B: DOM browsing
              tools from        accessibility tree +
              document.         click/type/scroll actions
              modelContext      (no tool access)
                       │               │
                headless Chromium on the same
                Shopware demo shop instance
```

Fairness rules:

- Same LLM, same parameters, same system-prompt structure; only the action
  space differs.
- Same shop instance, same seed data, same base URL.
- Fresh browser context (cookies, cart, session) per run; cart cleared
  between runs.
- Hard step limit (e.g. 30 model turns) and wall-clock limit per task; a
  task that exceeds either counts as failed.
- N ≥ 5 runs per task per arm to smooth out LLM nondeterminism; report
  median (and spread).

### Task battery (the six user tasks, made concrete)

| # | Task | Success check (automated) |
|---|------|---------------------------|
| 1 | Open category "X" | URL matches category; `shopware_webmcp_navigate` used or DOM shows category page |
| 2 | Open two products from that category | Both PDP URLs visited |
| 3 | Search for product "Y" | Search executed and target product appears in results |
| 4 | Filter products by criterion Z (e.g. price < X, color) | Filter applied to listing; result set matches expectation |
| 5 | Open a specific PDP | Product ID on page / returned by `get_product` matches |
| 6 | Add specific variant of product P to cart | Server-side cart contains exact `productId`/variant with correct quantity (`GET /webmcp/cart` as ground truth) |

Tasks 1–5 build up to task 6 as the "money shot": it is the task where DOM
agents typically fail (variant selection in modals, offcanvas cart) and where
`select_variant` + `add_to_cart` shine.

### Metrics

Primary (the ones for the talk):

1. **Wall-clock time per task** (first model request → success check passes).
2. **Total tokens** per task: input + output, logged per model call from the
   API response `usage` field. Also track *peak input tokens per call* — DOM
   snapshots blow up context; WebMCP keeps it flat. This is the most
   memorable comparison.
3. **Success rate** per task per arm (binary success check, no partial
   credit).

Secondary:

4. **Number of model turns / steps** to completion.
5. **Bytes of page content consumed**: sum of characters of DOM snapshots
   (Arm B) vs. sum of characters of tool results (Arm A).
6. **Cost in $** derived from token counts and model pricing.
7. **Error classes** in Arm B (selector not found, wrong variant, timeout) —
   anecdotal gold for the demo.

### How to measure

- **Tokens/cost**: log `usage` from every LLM API response in the harness;
  never estimate.
- **Time**: monotonic timer in the harness around each task.
- **Success**: scripted checkers, not the agent's self-report. Cart ground
  truth via `GET /webmcp/cart` (already returns structured data);
  navigation success via final URL + page state.
- **Page bytes**: instrument the DOM-snapshot serializer and the tool-call
  wrapper to record payload sizes.
- Write one JSONL record per run: `{arm, task, run, steps, timeMs,
  inputTokens, outputTokens, pageBytes, success, errorClass}`; aggregate with
  a tiny script into a markdown table.

## Decisions

- Decision: use a scripted harness + LLM function-calling loop, not an
  agentic browser product.
  Rationale: no browser ships WebMCP yet; a harness gives us full control
  over identical prompts, identical models, and exact token logging.
- Decision: Arm B interacts via accessibility-tree snapshots + Playwright
  actions, not raw HTML.
  Rationale: this is the state-of-the-art way real agents browse; raw HTML
  would make the comparison unfairly bad and easy to dismiss.
- Decision: if the native WebMCP flag is unavailable in a stable Chromium
  build, inject a `document.modelContext` shim that exposes exactly the same
  tool surface, and disclose this in the results.
  Rationale: the benchmark measures *tool-mediated vs. DOM-mediated
  interaction*, not the browser plumbing.
- Decision: run against one fixed demo shop snapshot.
  Rationale: product/catalog changes between runs would poison comparability.

## Non-Goals

- Not a statistically rigorous academic study; it is a demo benchmark.
- Not a comparison of different LLMs or frameworks.
- No changes to the plugin itself (the benchmark lives in a separate
  `benchmark/` folder or repo).

## Risks

- Risk: Arm B success depends heavily on snapshot quality → comparison looks
  rigged.
  Mitigation: use a standard a11y-tree snapshot (as Playwright/`browser_use`
  do), document it, and give Arm B generous limits.
- Risk: LLM nondeterminism.
  Mitigation: temperature 0 where possible, N ≥ 5 runs, report medians.
- Risk: WebMCP browser support changes during the origin trial.
  Mitigation: shim fallback keeps the benchmark runnable regardless.

## Verification

- Harness can run one task end-to-end in both arms on the demo shop.
- JSONL logs contain token usage from API responses, not estimates.
- Aggregated results table (median time, tokens, success rate per
  task × arm) is generated by one command.
