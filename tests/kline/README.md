# Kline cases

Kline is the durable test sink for this repository. A case is a runner-agnostic JSON scenario, not a Playwright spec and not a vendor suite.

`npm run kline` reads a green `artifacts/e2e.json` and writes one `*.kline.json` file per passed test. Each file validates against `schemas/kline-case.schema.json` and records:

- the public target (`name`, `baseUrl`)
- the source criterion id and E2E spec path
- which runner marked the E2E test passed (`verifiedBy`)
- ordered steps (`goto`, `click`, `fill`, `assertVisible`, `assertText`, `assertUrl`)

Commit the cases you want to keep. Dry-run cases are placeholders (`verifiedBy` is `dry-run`) and are not evidence that a browser passed.

The converter copies the structured scenario stored on the E2E artifact. It does not parse TypeScript.
