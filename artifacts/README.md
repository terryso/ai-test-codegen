# Artifacts

Each pipeline step writes one JSON file in this directory. Generated JSON is gitignored. The schemas in `schemas/` are the contract.

| Step | File | Reads |
| --- | --- | --- |
| explore | `artifacts/explore.json` | Site config and environment |
| criteria | `artifacts/criteria.json` | `artifacts/explore.json` and the site config |
| e2e | `artifacts/e2e.json` | `artifacts/criteria.json` and the site config |
| kline | `artifacts/kline.json` | `artifacts/e2e.json` and the site config |

Step N+1 does not need earlier artifacts. The E2E file embeds the scenario (ordered steps) so the Kline converter does not parse Playwright source.

Shared fields:

- `schemaVersion` — currently `1.0.0`
- `step` — `explore`, `criteria`, `e2e`, or `kline`
- `generatedAt` — ISO-8601 timestamp
- `dryRun` — whether the step skipped the network and the browser
- `target.name` / `target.baseUrl` — public site identity (no userinfo, no secrets)

`artifacts/e2e.json` adds `run.status` of `green`, `pending`, or `failed`. Kline runs only when that status is `green`.

`artifacts/kline.json` indexes the case files written to `tests/kline/`.
