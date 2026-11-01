# Playwright E2E

Two generators write this tree. They use different markers and do not delete each other's files.

## Production specs (`@generated pipeline:export-pw`)

Humans maintain `tests/nl/**/*.e2e.ts`. After `npm run run-nl` is green, `npm run export-pw` reads `.e2e/cache` and writes one spec per NL file, mirroring the directory:

```text
tests/nl/saucedemo/gen-01-login.e2e.ts
  → tests/e2e/saucedemo/gen-01-login.spec.ts
```

Those specs are generated. Delete them and export again. Do not hand-edit them as the source of truth. The export fails when the NL run is not green or an `agent.act` has no cache hit.

## Planning placeholder (`@generated pipeline:e2e`)

`npm run e2e` writes one flat `*.spec.ts` per acceptance criterion. A dry-run records those specs as passed in `artifacts/e2e.json` (`origin: "criteria"`) without launching a browser. A live planning run writes the same specs and leaves the run `pending`. That placeholder is not the production export.

Run generated specs with:

```bash
npx playwright install
TARGET_URL=https://www.saucedemo.com npm run test:e2e
```

`TARGET_URL` becomes Playwright `baseURL`. Specs that navigate with `page.goto("/")` resolve against it.
