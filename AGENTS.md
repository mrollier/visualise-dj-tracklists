# AGENTS.md

## Project

This is a local-first Svelte 5 + TypeScript + Vite application for
visualising DJ track libraries and building tracklists.

Read the README and relevant docs before making architectural
recommendations. Preserve the documented product behaviour and
non-goals unless a finding explicitly identifies a contradiction,
bug, or maintainability problem.

## Important principles

- Prefer correctness and maintainability over cleverness.
- Do not make speculative refactors merely to reduce line count.
- Preserve deterministic behaviour in visualisation/layout algorithms.
- Treat the documented UX behaviour as intentional unless evidence
  shows otherwise.
- Avoid changing public behaviour while performing cleanup unless the
  change is explicitly justified.
- Investigate performance implications for large DJ libraries.
- Pay particular attention to state management, derived state,
  reactivity, browser performance, memory usage, and algorithmic
  complexity.

## Validation

Before considering a change complete, run:

npm run check
npm run lint
npm test
npm run build

Use Playwright/browser tests where appropriate for UI behaviour.

## Audit expectations

When reviewing the repository:

- Inspect the entire source tree, tests, scripts, configuration and
  documentation.
- Distinguish confirmed bugs from possible risks.
- Prefer concrete evidence over style preferences.
- For every proposed refactor, explain the benefit and risk.
- Look for missing tests around important behaviour, not just missing
  line coverage.
- Look for performance problems with realistic library sizes.
- Look for state/async/race-condition bugs.
- Look for browser-specific problems and failure modes.