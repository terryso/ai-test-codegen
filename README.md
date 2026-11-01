# ai-test-codegen

A small, site-agnostic pipeline that turns a website into test code. Point it at any `http(s)` origin. It does not assume a product, login vendor, or existing test suite.

The pipeline has four steps. Each step reads the previous step's JSON artifact plus the site config, then writes its own artifact.

1. **Explore** maps the site: pages, flows, selectors, and the auth surface.
2. **Criteria** turns that map into acceptance criteria.
3. **E2E** generates Playwright specs from the criteria. A dry-run marks them green. The live stub writes the specs and leaves the run pending until an agent executes them.
4. **Kline** copies green scenarios into a durable, runner-agnostic JSON format and stores them in the repo.

## Kline

Kline is this repo's durable test sink. A green Playwright spec is tied to one runner. A Kline case (`tests/kline/<id>.kline.json`) keeps the same scenario as data: public target, ordered steps, and the source spec path. Later tooling can render that JSON into Playwright or another runner. The folder and the `format: "kline"` field are the contract. The converter stub copies the structured scenario already stored on the E2E artifact; it does not parse TypeScript.

Only a run whose `artifacts/e2e.json` status is `green` can be converted. Dry-run output is a placeholder (`verifiedBy: "dry-run"`), not evidence a browser passed.

## Layout

```
config/site.example.json     public site description (copy to config/site.json)
pipeline/                    step implementations
  steps/explore.ts
  steps/criteria.ts
  steps/e2e.ts
  steps/kline.ts
scripts/pipeline.ts          CLI
schemas/                     JSON Schema for config and each artifact
artifacts/                   step JSON (generated files are gitignored)
tests/e2e/                   generated Playwright specs
tests/kline/                 generated Kline cases
tests/pipeline/              dry-run smoke tests
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

## Environment

| Variable | Purpose |
| --- | --- |
| `TARGET_URL` | Overrides `baseUrl`. Userinfo in the URL is stripped and never stored. |
| `TARGET_NAME` | Overrides the site name. |
| `SITE_CONFIG` | Path to the site config JSON. |
| `AUTH_LOGIN_URL` | Login page. Overrides `auth.loginUrl`. |
| `AUTH_USERNAME` | Runtime only. Not written to artifacts or tests. |
| `AUTH_PASSWORD` | Runtime only. Not written to artifacts or tests. |
| `AUTH_USERNAME_SELECTOR` | Optional selector override. |
| `AUTH_PASSWORD_SELECTOR` | Optional selector override. |
| `AUTH_SUBMIT_SELECTOR` | Optional selector override. |
| `DRY_RUN` | `1`, `true`, or `yes` acts like `--dry-run`. |
| `PLAYWRIGHT_CHANNEL` | Optional installed browser channel for `npm run test:e2e`, such as `chrome`. |

`authSurface.credentialsConfigured` is `true` when both `AUTH_USERNAME` and `AUTH_PASSWORD` are non-empty. The values themselves are not recorded.

## Run the steps

```bash
npm install
npm run pipeline -- --dry-run
```

That runs all four steps against `config/site.example.json` (or `config/site.json` if you created one) and writes placeholder artifacts. The specs and Kline cases currently in `tests/e2e/` and `tests/kline/` are that example.com dry-run sample. A later run overwrites the generated files.

Individual steps, in order:

```bash
npm run explore -- --dry-run
npm run criteria -- --dry-run
npm run e2e -- --dry-run
npm run kline -- --dry-run
```

Flags:

```text
--dry-run            Skip the network and the browser
--config <file>      Site config JSON
--artifacts <dir>    Artifact directory (default artifacts/)
--e2e-dir <dir>      Playwright output (default tests/e2e/)
--kline-dir <dir>    Kline output (default tests/kline/)
```

Without `--dry-run`, explore fetches `baseUrl` once and records the HTTP status and `<title>`. Selector and flow discovery are still a stub. The E2E step writes Playwright specs and sets `run.status` to `pending`. Kline then exits with an error until a green artifact exists.

To execute generated specs in a browser:

```bash
npx playwright install
TARGET_URL=https://example.com npm run test:e2e
```

If Playwright's downloaded browser is unavailable, `PLAYWRIGHT_CHANNEL=chrome` uses a locally installed Chrome.

## Data flow

```text
site config + env
    -> artifacts/explore.json
        -> artifacts/criteria.json
            -> tests/e2e/*.spec.ts
            -> artifacts/e2e.json          (includes the scenario steps)
                -> tests/kline/*.kline.json
                -> artifacts/kline.json
```

| Artifact | Schema |
| --- | --- |
| site config | `schemas/site-config.schema.json` |
| `artifacts/explore.json` | `schemas/explore.schema.json` |
| `artifacts/criteria.json` | `schemas/criteria.schema.json` |
| `artifacts/e2e.json` | `schemas/e2e.schema.json` |
| `artifacts/kline.json` | `schemas/kline.schema.json` |
| `tests/kline/*.kline.json` | `schemas/kline-case.schema.json` |

Actions shared by flows, criteria, specs, and Kline cases: `goto`, `click`, `fill`, `assertVisible`, `assertText`, `assertUrl`. A `fill` value of `$ENV:SOME_NAME` is emitted as `process.env.SOME_NAME` so the secret stays out of the spec.

## Checks

```bash
npm run typecheck
npm test
```

`npm test` runs the dry-run in a temporary directory and checks that a non-green E2E artifact is rejected by the Kline step.
