# Natural-language e2e

People maintain the tests in this tree. Each file is an [`e2e`](https://e2e.tester.army/docs) test (`*.e2e.ts`).

Playwright files under `tests/e2e/` that mirror these paths are generated. After `npm run run-nl` is green and `.e2e/cache/` holds the settled traces, `npm run export-pw` regenerates them. Delete the specs and export again. Do not hand-edit a generated spec as the source of truth.

Sauce Demo layout:

```text
tests/nl/saucedemo/gen-01-login.e2e.ts
  → tests/e2e/saucedemo/gen-01-login.spec.ts
tests/nl/saucedemo/gen-02-add-to-cart.e2e.ts
  → tests/e2e/saucedemo/gen-02-add-to-cart.spec.ts
```

Every `agent.act` needs a later check (`agent.assert`, `agent.waitFor`, or a locator `expect`) so the runner can settle a trace. `npm run export-pw` fails when that trace is missing.
