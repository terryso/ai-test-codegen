# Playwright E2E

`npm run e2e` writes one `*.spec.ts` per acceptance criterion. Files carry the header `@generated pipeline:e2e`. The step replaces previously generated specs in this directory and leaves other files alone.

A dry-run records those specs as passed in `artifacts/e2e.json` without launching a browser. A live run writes the same specs and leaves the run `pending` until an agent loop executes them.

Run the specs with:

```bash
npx playwright install
TARGET_URL=https://example.com npm run test:e2e
```

`TARGET_URL` should be the same site the pipeline used. Specs navigate by path, and `playwright.config.ts` sets `baseURL` from `TARGET_URL`.
