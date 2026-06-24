# AGENTS.md — Repository-wide Rules

This file defines cross-project rules for all parts of the repository.
Subproject-specific AGENTS.md files override and extend these rules.

## 1. Engineering Principles
1. Prefer simple, readable, modular solutions over clever ones.
2. Keep code cohesive and decoupled; avoid god objects, god services, and oversized files.
3. Reuse and improve existing files before creating new ones.
4. Do not introduce dead code, speculative abstractions, or unused helpers.
5. Keep naming explicit and consistent with the local project conventions.
6. Prioritize maintainability, security, reliability, and developer ergonomics.
7. For meaningful product/user lifecycle events, emit the corresponding research telemetry/Amplitude event through the existing backend-owned telemetry pipeline. Do not expose Amplitude credentials or raw sensitive content to the frontend, sandbox, or generated storefront code.

## 2. Scope Discipline
1. Implement only what is needed for the requested task and current architecture.
2. For MVP work, prefer the smallest change that fits the current design.
3. Do not introduce new infrastructure, frameworks, or patterns unless clearly justified.
4. Do not perform unrelated refactors unless they are necessary to complete the task safely.

## 3. Directory and README Awareness
1. Read the local `README.md` in the relevant folder before making changes.
2. If a folder has no `README.md`, create a concise one only if understanding that folder is necessary for safe changes.
3. README files must explain purpose and structure, not act as work logs.
4. Do not create extra markdown documentation unless explicitly requested.

## 4. Validation and Safety
1. Validate all external inputs at runtime.
2. Resolve compilation and type errors before finishing.
3. Never log secrets, tokens, credentials, or sensitive identifiers.
4. Never hardcode secrets or example credentials into source files.
5. Prefer explicit error handling over silent failure.
6. When changing user-facing LLM orchestration, keep related offline evals in sync.
   For design preview changes involving prompt wrapping, reconciliation, store/product
   hydration, retry/fallback behavior, or design-pass inputs, check
   `storefront/evals/src/features/design-preview` and mention the eval impact in
   the final response.

## 5. File Creation Rules
1. Do not create new files before checking whether an existing file can be extended.
2. Keep new files small and purpose-specific.
3. Prefer local consistency over inventing new patterns.

## 6. Git and Execution Restrictions
1. Do not run git operations unless explicitly requested.
2. Do not create tests unless explicitly requested.
3. Do not generate changelog-style markdown summaries of your work unless explicitly requested.

## 7. Progress Tracking
1. Only create a temporary progress file if the task is large or multi-step.
2. Name it `progress-task.md` in the repo root.
3. Delete it before finishing the task.

## 8. When Unclear
1. Ask for clarification only when ambiguity would likely cause the wrong implementation.
2. Otherwise make the safest minimal assumption and keep the change easy to adjust.
3. When raising a question, include the recommended default and why.

## 9. Subproject Priority
When working inside a subproject, follow:
1. this root file
2. the nearest local `AGENTS.md`
3. the local `README.md`
4. existing code conventions
