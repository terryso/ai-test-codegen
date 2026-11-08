# Artifacts

Each pipeline step writes one JSON file in this directory. Generated JSON is gitignored. The schemas in `schemas/` are the contract.

| Step | File | Reads |
| --- | --- | --- |
| explore | `artifacts/explore.json` | Site config and environment |
| criteria | `artifacts/criteria.json` | `artifacts/explore.json` and the site config |
| e2e (planning) | `artifacts/e2e.json` | `artifacts/criteria.json` and the site config. `origin` is `criteria`. |
| run-nl | `artifacts/run-nl.json` | `tests/nl/**/*.e2e.ts`. A live pass also settles `.e2e/cache`. |
| export-pw | `artifacts/e2e.json` | A green `artifacts/run-nl.json` and `.e2e/cache`. `origin` is `replay-cache`. |
| kline | `artifacts/kline.json` | A green `artifacts/e2e.json` and the site config |

`export-pw` overwrites `artifacts/e2e.json`. It generates Playwright from the replay cache. The planning `e2e` step is a separate placeholder renderer and is not called by `export-pw`.

Shared fields:

- `schemaVersion` — currently `1.0.0`
- `step` — `explore`, `criteria`, `e2e`, `run-nl`, or `kline`
- `generatedAt` — ISO-8601 timestamp
- `dryRun` — whether the step skipped the network and the browser
- `target.name` / `target.baseUrl` — public site identity (no userinfo, no secrets)

`artifacts/run-nl.json` status is `green`, `pending`, or `failed`. `export-pw` runs only when that status is `green`.

`artifacts/e2e.json` adds `run.status` of `green`, `pending`, or `failed`. Kline runs only when that status is `green`. Optional `origin` is `criteria` or `replay-cache`. Replay-cache tests include `nlFile` and a `criteriaId` of `<nl file>#<title>`.

`artifacts/kline.json` indexes the case files written to `tests/kline/`.
