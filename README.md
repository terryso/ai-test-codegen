# ai-test-codegen

Humans maintain natural-language end-to-end tests in `tests/nl/**/*.e2e.ts`. Playwright specs that mirror those files are generated from the replay cache of a green NL run. Delete `tests/e2e/**/*.spec.ts` files marked `@generated pipeline:export-pw` and run `npm run export-pw` again. Do not hand-edit a generated spec as the source of truth.

The planning steps (explore, criteria, and the criteria placeholder `npm run e2e`) still exist for a site-agnostic dry-run. They are not the production Playwright export.

## Production path

```text
tests/nl/**/*.e2e.ts                 human source
        │  npm run run-nl            e2e runner; must pass
        ▼
artifacts/run-nl.json                status green
.e2e/cache/*.json                    settled trace-1 recordings
        │  npm run export-pw         scripts/export-playwright.mjs
        ▼
tests/e2e/**/*.spec.ts               one spec per NL file, same relative path
artifacts/e2e.json                   origin replay-cache
        │  npm run kline
        ▼
tests/kline/*.kline.json
```

Sauce Demo layout:

```text
tests/nl/saucedemo/gen-01-login.e2e.ts
  → tests/e2e/saucedemo/gen-01-login.spec.ts
tests/nl/saucedemo/gen-02-add-to-cart.e2e.ts
  → tests/e2e/saucedemo/gen-02-add-to-cart.spec.ts
```

`npm run export-pw` fails when `artifacts/run-nl.json` is missing or not green, when `.e2e/cache` is missing, or when an `agent.act` has no cache hit. A spec is not assembled by parsing the NL sentence into locators, and this command does not call the criteria renderer.

Each `agent.act` needs a later check (`agent.assert`, `agent.waitFor`, or a locator `expect`) so the e2e runner can settle a trace. `e2e.config.ts` sets `cache.mode` to `read-write`. An unset mode becomes read-only when `CI` is set, and a green run would then leave the cache empty.

Digest match uses SHA-256 of the normalized instruction text, the same rule as e2e 0.22 (`normalizeInstruction`: CRLF to LF, NFC, trim). Locators come from the recorded target (`testId`, then role and name, placeholder, or text).

## Verify a Sauce Demo export

This repository checkout does not run Sauce Demo by itself: a live `npm run run-nl` needs a configured model provider and a browser. On a machine that already has those:

```bash
npm install
npm run run-nl
npm run export-pw
TARGET_URL=https://www.saucedemo.com npm run test:e2e -- tests/e2e/saucedemo
```

`run-nl` is green only when `e2e run` exits 0 and `.e2e/report.json` says `passed`. Then `.e2e/cache/` should contain `trace-1` files. `export-pw` rewrites the mirrored specs from those files. The Playwright command above is a separate execution of the generated specs; `export-pw` does not launch them.

Model setup is the e2e quickstart: https://e2e.tester.army/docs/quickstart

## Planning path

Point the planning steps at any `http(s)` origin. They do not assume a product, login vendor, or existing suite.

1. **Explore** maps the site: pages, flows, selectors, and the auth surface.
2. **Criteria** turns that map into acceptance criteria.
3. **E2E placeholder** (`npm run e2e`) writes `@generated pipeline:e2e` specs from those criteria. A dry-run marks them green. The live path writes the specs and leaves the run pending. `artifacts/e2e.json` records `origin: "criteria"`.
4. **Kline** copies a green E2E artifact into runner-agnostic JSON.

`npm run pipeline -- --dry-run` runs those four planning steps. It does not call `run-nl` or `export-pw`.

## Kline

Kline is this repo's durable test sink. A Kline case (`tests/kline/<id>.kline.json`) keeps the scenario as data: public target, ordered steps, and the source spec path. The converter copies the structured scenario stored on the E2E artifact; it does not parse TypeScript.

Only a run whose `artifacts/e2e.json` status is `green` can be converted. For a criteria dry-run, `verifiedBy` is `dry-run`. For a cache export, `verifiedBy` is `replay-cache`: the NL run settled the recording, and Playwright was not executed by the export step.

Replay-cache scenario steps are a projection of trace actions onto `goto`, `click`, `fill`, `assertVisible`, `assertText`, and `assertUrl`. Quoted text from `agent.assert` / `agent.waitFor` becomes `assertText`. The spec itself is the locator replay, not this projection.

## Layout

```text
config/site.example.json     public site description (copy to config/site.json)
e2e.config.ts                e2e runner for tests/nl (cache read-write)
pipeline/                    step implementations
  steps/explore.ts
  steps/criteria.ts
  steps/e2e.ts               criteria placeholder renderer
  steps/run-nl.ts            executes tests/nl, writes artifacts/run-nl.json
  steps/export-pw.ts         green run-nl + .e2e/cache → Playwright
  steps/kline.ts
scripts/pipeline.ts          CLI
scripts/export-playwright.mjs
                             cache → spec exporter (node, no criteria)
schemas/                     JSON Schema for config and each artifact
artifacts/                   step JSON (generated files are gitignored)
tests/nl/                    human-maintained natural-language tests
tests/e2e/                   generated Playwright specs
tests/kline/                 generated Kline cases
tests/pipeline/              pipeline tests
.e2e/cache/                  replay cache (gitignored, local to a green run-nl)
```

## Configure a target site

Copy the example config and edit the public fields:

```bash
cp config/site.example.json config/site.json
```

`config/site.json` is gitignored. Set `name`, `baseUrl`, the paths to crawl, and optional login selectors. Put secrets in the environment, not in the JSON file.

```bash
cp .env.example .env
```

The CLI loads `.env` without overriding variables that are already set.

The Sauce Demo NL suite uses `e2e.config.ts` (`https://www.saucedemo.com`). Planning steps use the site config instead.

## Environment

| Variable | Purpose |
| --- | --- |
| `TARGET_URL` | Overrides `baseUrl` for planning steps and Playwright `baseURL`. Userinfo in the URL is stripped and never stored. |
| `TARGET_NAME` | Overrides the site name. |
| `SITE_CONFIG` | Path to the site config JSON. |
| `AUTH_LOGIN_URL` | Login page. Overrides `auth.loginUrl`. |
| `AUTH_USERNAME` | Runtime only. Not written to artifacts or tests. |
| `AUTH_PASSWORD` | Runtime only. Not written to artifacts or tests. |
| `AUTH_USERNAME_SELECTOR` | Optional selector override. |
| `AUTH_PASSWORD_SELECTOR` | Optional selector override. |
| `AUTH_SUBMIT_SELECTOR` | Optional selector override. |
| `DRY_RUN` | `1`, `true`, or `yes` acts like `--dry-run`. `export-pw` still refuses. |
| `PLAYWRIGHT_CHANNEL` | Optional installed browser channel for `npm run test:e2e`, such as `chrome`. |
| `E2E_TELEMETRY_DISABLED` | Set to `1` by `run-nl` when it spawns the e2e CLI. |

`authSurface.credentialsConfigured` is `true` when both `AUTH_USERNAME` and `AUTH_PASSWORD` are non-empty. The values themselves are not recorded.

## Run the steps

```bash
npm install
npm run pipeline -- --dry-run
```

That runs the four planning steps against `config/site.example.json` (or `config/site.json` if you created one) and writes placeholder artifacts. The flat spec `tests/e2e/ac-flow-home-visible.spec.ts` and the Kline case next to it are that example.com dry-run sample. They carry `@generated pipeline:e2e`. A later planning run overwrites generated files with that marker. It leaves `@generated pipeline:export-pw` specs alone, and `export-pw` leaves the criteria marker alone.

Individual planning steps, in order:

```bash
npm run explore -- --dry-run
npm run criteria -- --dry-run
npm run e2e -- --dry-run
npm run kline -- --dry-run
```

Production export, after a green NL run has filled `.e2e/cache`:

```bash
npm run run-nl
npm run export-pw
npm run kline
```

`npm run run-nl -- --dry-run` writes `artifacts/run-nl.json` with status `pending` and does not touch the cache.

Flags:

```text
--dry-run            Planning placeholder. run-nl stays pending. export-pw exits with an error.
--config <file>      Site config JSON
--artifacts <dir>    Artifact directory (default artifacts/)
--e2e-dir <dir>      Playwright output (default tests/e2e/)
--kline-dir <dir>    Kline output (default tests/kline/)
--nl-dir <dir>       NL sources (default tests/nl/)
--cache-dir <dir>    Replay cache (default .e2e/cache/)
```

Without `--dry-run`, explore fetches `baseUrl` once and records the HTTP status and `<title>`. Selector and flow discovery are still a stub. The criteria E2E step writes placeholder Playwright specs and sets `run.status` to `pending`. Kline then exits with an error until a green artifact exists.

To execute generated specs in a browser:

```bash
npx playwright install
TARGET_URL=https://www.saucedemo.com npm run test:e2e
```

If Playwright's downloaded browser is unavailable, `PLAYWRIGHT_CHANNEL=chrome` uses a locally installed Chrome. Specs that call `page.goto("/")` use `baseURL` from `TARGET_URL`.

## Data flow

```text
planning:
  site config + env
    -> artifacts/explore.json
        -> artifacts/criteria.json
            -> tests/e2e/*.spec.ts          (@generated pipeline:e2e)
            -> artifacts/e2e.json           (origin criteria)

production:
  tests/nl/**/*.e2e.ts
    -> artifacts/run-nl.json                (green)
    -> .e2e/cache
        -> tests/e2e/**/*.spec.ts           (@generated pipeline:export-pw)
        -> artifacts/e2e.json               (origin replay-cache)
            -> tests/kline/*.kline.json
            -> artifacts/kline.json
```

| Artifact | Schema |
| --- | --- |
| site config | `schemas/site-config.schema.json` |
| `artifacts/explore.json` | `schemas/explore.schema.json` |
| `artifacts/criteria.json` | `schemas/criteria.schema.json` |
| `artifacts/run-nl.json` | `schemas/run-nl.schema.json` |
| `artifacts/e2e.json` | `schemas/e2e.schema.json` |
| `artifacts/kline.json` | `schemas/kline.schema.json` |
| `tests/kline/*.kline.json` | `schemas/kline-case.schema.json` |

Actions shared by flows, criteria, specs, and Kline cases: `goto`, `click`, `fill`, `assertVisible`, `assertText`, `assertUrl`. A `fill` value of `$ENV:SOME_NAME` is emitted as `process.env.SOME_NAME` so the secret stays out of the spec.

## Checks

```bash
npm run typecheck
npm test
```

`npm test` runs the planning dry-run in a temporary directory, checks that a non-green E2E artifact is rejected by Kline, and checks that `export-pw` requires a green `run-nl` plus a cache hit.
