---
name: explore-to-test
description: Generate Playwright from a green natural-language e2e run's replay cache. Use when exporting Playwright, editing export-pw or run-nl, or changing tests/nl.
---

# Explore to test

Humans maintain `tests/nl/**/*.e2e.ts`. Playwright under `tests/e2e/**` is generated and can be deleted. Do not hand-edit a generated spec as the source of truth.

## Production export

1. `npm run run-nl` executes the NL files with the `e2e` runner and writes `artifacts/run-nl.json`.
2. A passing run settles `trace-1` entries in `.e2e/cache`. `e2e.config.ts` sets `cache.mode` to `read-write` so an ambient `CI` variable does not silently drop writes.
3. `npm run export-pw` checks that `artifacts/run-nl.json` is `green`, then `scripts/export-playwright.mjs` mirrors each NL file to a spec:

```text
tests/nl/saucedemo/gen-01-login.e2e.ts
  → tests/e2e/saucedemo/gen-01-login.spec.ts
```

The exporter hashes each `agent.act` instruction with SHA-256 after `normalizeInstruction` (CRLF to LF, NFC, trim), the e2e 0.22 digest, and replays the matching cache entry's actions as Playwright locators (`testId`, then role+name, placeholder, or text). `agent.assert`, `agent.waitFor`, and observation acts (`观察` / `Observe`) become comments plus quoted-text expects. A file with no replayed act fails. A cache miss fails. A run-nl that is missing or not green fails.

`export-pw` does not call `pipeline/steps/e2e.ts` and does not invent locators from criteria steps or from the NL sentence.

It writes `artifacts/e2e.json` with `origin: "replay-cache"` and `run.runner: "replay-cache"`. `npm run kline` can store that artifact. `verifiedBy` means the NL recording settled, not that Playwright was executed.

## Planning steps

`npm run explore`, `npm run criteria`, and `npm run e2e` remain the site-agnostic planning path. `npm run e2e` writes `@generated pipeline:e2e` placeholders from acceptance criteria (`origin: "criteria"`). Keep that renderer for the dry-run demo. Do not wire it into `export-pw`.

`npm run pipeline -- --dry-run` runs explore → criteria → e2e placeholder → kline. It does not export from the cache. `npm run run-nl -- --dry-run` stays `pending`.

## When changing the exporter

- Read cache files as `trace-1` (`payload.recordedFor.instructionDigest`, `payload.actions`, `payload.endAnchors`).
- Fail closed on a miss, an unreadable overrides file, or an action the exporter cannot replay (`tool`, unnamed secret).
- Leave `@generated pipeline:e2e` files in place. Only delete `@generated pipeline:export-pw`.
- Do not claim a Sauce Demo run passed unless `npm run run-nl` actually exited green on that machine and `.e2e/cache` gained the traces.
