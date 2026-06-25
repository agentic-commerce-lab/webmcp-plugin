# AGENTS.md - Repository Rules

This file applies to the whole Shopware WebMCP plugin repository. It is
intended to guide agents working in this repo, not to describe unrelated
projects or product systems.

## 1. Project Context
1. This repository is a Shopware 6 plugin that publishes a WebMCP side-car
   document and browser-side `document.modelContext` tools for storefronts.
2. Keep the package structure conventional for a Shopware platform plugin:
   `composer.json`, `src/SwagWebMcp.php`, `src/WebMcp`,
   `src/Resources/config`, `src/Resources/views`,
   `src/Resources/app/storefront`, and `src/Resources/public`.
3. Read the root `README.md` before code changes. If a nearer `AGENTS.md` or
   `README.md` is added later, follow it for that subtree.
4. When adding new features or changing configuration, update the README.md.

## 2. Engineering Principles
1. Prefer simple, readable, modular solutions over clever ones.
2. Keep code cohesive and decoupled; avoid god objects, god services, and
   oversized files.
3. Reuse and improve existing files before creating new ones.
4. Do not introduce dead code, speculative abstractions, or unused helpers.
5. Keep naming explicit and consistent with the local Shopware and WebMCP
   conventions.
6. Prioritize maintainability, security, reliability, and developer ergonomics.

## 3. Scope Discipline
1. Implement only what is needed for the requested task and current
   architecture.
2. Prefer the smallest change that fits the current design.
3. Do not introduce new infrastructure, frameworks, build systems, or runtime
   dependencies unless clearly justified.
4. Do not perform unrelated refactors unless they are necessary to complete the
   task safely.
5. Keep PHP compatibility aligned with `composer.json` and avoid using language
   features outside the configured platform version.

## 4. Shopware and WebMCP Contracts
1. Preserve the public endpoints unless the task explicitly changes them:
   `GET /webmcp.wmcp` and `GET /webmcp/cart`.
2. The WebMCP document endpoint should return `application/webmcp+json` and
   remain unavailable when the plugin is disabled.
3. Keep Shopware Admin configuration, service wiring, routes, Twig data
   attributes, and storefront runtime behavior in sync.
4. Preserve the browser globals and tool surface expected by the README:
   `document.webMcp`, `document.modelContext`, `window.SwagWebMcp`, and
   `shopware.webmcp.*` tool names.
5. Keep tool inputs and outputs stable, especially `structuredContent`, unless
   the requested change intentionally updates the WebMCP contract.
6. Changes to `src/Resources/public/webmcp-model-context.js` affect both the
   direct public fallback script and the Shopware storefront plugin import.

## 5. Validation and Safety
1. Validate external input at runtime, including plugin config JSON,
   `staticElementsJson`, route input, Store API payloads, and browser tool
   arguments.
2. Prefer explicit error handling over silent failure.
3. Never log secrets, tokens, credentials, storefront session identifiers, CSRF
   tokens, or raw sensitive user/cart data.
4. Do not hardcode credentials, Store API access keys, example secrets, or
   environment-specific URLs in source files.
5. Browser-side code must not expose private backend credentials. Use the
   existing Shopware storefront/session boundaries for cart operations.
6. Normalize and constrain URLs, selectors, HTTP methods, quantities, product
   identifiers, and other user-controllable values before emitting or using
   them.

## 6. JavaScript and Storefront Runtime
1. Use the existing vanilla JavaScript module style in
   `src/Resources/public/webmcp-model-context` unless the task requires
   otherwise.
2. Keep storefront registration through `window.PluginManager` and the public
   fallback runtime compatible with Shopware storefront compilation.
3. Avoid adding frontend package managers, bundlers, or browser dependencies.
4. Keep runtime behavior idempotent so repeated bootstrap calls do not register
   duplicate tools or break existing `document.modelContext` helpers.

## 7. File Creation Rules
1. Do not create new files before checking whether an existing file can be
   extended.
2. Keep new files small and purpose-specific.
3. Prefer local consistency over inventing new patterns.
4. Do not add a new test framework unless explicitly requested.

## 8. Validation Commands
1. For normal repository QA, use:
   `docker compose run --rm qa`
2. To check the installable package, use:
   `docker compose run --rm qa bin/build-zip.sh`
3. If host PHP and Composer are available, `composer qa` is acceptable for a
   quick local lint pass.
4. Resolve compilation, lint, and type errors before finishing. If validation
   cannot be run, explain why in the final response.

## 9. Git and Execution
1. Read-only git inspection such as `git status`, `git diff`, `git show`, and
   `git log` is allowed when it helps avoid overwriting user work.
2. Do not mutate git state, create commits, reset files, rebase, merge, or
   checkout branches unless explicitly requested.
3. Do not generate changelog-style markdown summaries unless explicitly
   requested.

## 10. Progress Tracking
1. Only create a temporary progress file if the task is large or multi-step.
2. Name it `progress-task.md` in the repo root.
3. Delete it before finishing the task.

## 11. When Unclear
1. Ask for clarification only when ambiguity would likely cause the wrong
   implementation.
2. Otherwise make the safest minimal assumption and keep the change easy to
   adjust.
3. When raising a question, include the recommended default and why.
