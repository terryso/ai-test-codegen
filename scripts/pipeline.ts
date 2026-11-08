import { envFlag, loadDotEnv } from "../pipeline/env";
import { PipelineError } from "../pipeline/errors";
import { DEFAULT_PATHS } from "../pipeline/paths";
import { runAll, runStep } from "../pipeline/run";
import type { PipelineOptions } from "../pipeline/types";

const STEPS = ["explore", "criteria", "e2e", "run-nl", "export-pw", "kline", "all"] as const;
type Command = (typeof STEPS)[number];

async function main(): Promise<void> {
  await loadDotEnv();
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    if (parsed.message) {
      console.error(parsed.message);
    }
    console.error(helpText());
    process.exitCode = 1;
    return;
  }
  const options: PipelineOptions = {
    dryRun: parsed.dryRun,
    configPath: parsed.configPath,
    artifactsDir: parsed.artifactsDir,
    e2eDir: parsed.e2eDir,
    klineDir: parsed.klineDir,
    nlDir: parsed.nlDir,
    cacheDir: parsed.cacheDir,
  };
  if (parsed.command === "all") {
    await runAll(options);
    return;
  }
  await runStep(parsed.command, options);
}

function parseArgs(argv: string[]):
  | {
      ok: true;
      command: Command;
      dryRun: boolean;
      configPath?: string;
      artifactsDir: string;
      e2eDir: string;
      klineDir: string;
      nlDir: string;
      cacheDir: string;
    }
  | { ok: false; message: string } {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    return { ok: false, message: command ? "" : "Missing command." };
  }
  if (!isCommand(command)) {
    return { ok: false, message: `Unknown command "${command}".` };
  }
  let dryRun = envFlag("DRY_RUN");
  let configPath: string | undefined;
  let artifactsDir: string = DEFAULT_PATHS.artifactsDir;
  let e2eDir: string = DEFAULT_PATHS.e2eDir;
  let klineDir: string = DEFAULT_PATHS.klineDir;
  let nlDir: string = DEFAULT_PATHS.nlDir;
  let cacheDir: string = DEFAULT_PATHS.cacheDir;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--config") {
      const value = rest[index + 1];
      if (!value) {
        return { ok: false, message: "--config requires a path." };
      }
      configPath = value;
      index += 1;
      continue;
    }
    if (token === "--artifacts") {
      const value = rest[index + 1];
      if (!value) {
        return { ok: false, message: "--artifacts requires a directory." };
      }
      artifactsDir = value;
      index += 1;
      continue;
    }
    if (token === "--e2e-dir") {
      const value = rest[index + 1];
      if (!value) {
        return { ok: false, message: "--e2e-dir requires a directory." };
      }
      e2eDir = value;
      index += 1;
      continue;
    }
    if (token === "--kline-dir") {
      const value = rest[index + 1];
      if (!value) {
        return { ok: false, message: "--kline-dir requires a directory." };
      }
      klineDir = value;
      index += 1;
      continue;
    }
    if (token === "--nl-dir") {
      const value = rest[index + 1];
      if (!value) {
        return { ok: false, message: "--nl-dir requires a directory." };
      }
      nlDir = value;
      index += 1;
      continue;
    }
    if (token === "--cache-dir") {
      const value = rest[index + 1];
      if (!value) {
        return { ok: false, message: "--cache-dir requires a directory." };
      }
      cacheDir = value;
      index += 1;
      continue;
    }
    return { ok: false, message: `Unknown argument "${token}".` };
  }
  return { ok: true, command, dryRun, configPath, artifactsDir, e2eDir, klineDir, nlDir, cacheDir };
}

function isCommand(value: string): value is Command {
  return (STEPS as readonly string[]).includes(value);
}

function helpText(): string {
  return `Usage: pipeline <explore|criteria|e2e|run-nl|export-pw|kline|all> [options]

Options:
  --dry-run            Planning steps only. run-nl stays pending. export-pw refuses it.
  --config <file>      Site config JSON (default: config/site.json or config/site.example.json)
  --artifacts <dir>    Artifact directory (default: artifacts)
  --e2e-dir <dir>      Playwright output directory (default: tests/e2e)
  --kline-dir <dir>    Kline output directory (default: tests/kline)
  --nl-dir <dir>       Human-maintained NL tests (default: tests/nl)
  --cache-dir <dir>    e2e replay cache (default: .e2e/cache)

Planning steps (criteria placeholder, not the production Playwright export):
  explore  -> artifacts/explore.json
  criteria -> artifacts/criteria.json
  e2e      -> artifacts/e2e.json (origin criteria) and tests/e2e/*.spec.ts

Production path (humans maintain tests/nl; Playwright is regenerated from the cache):
  run-nl    -> artifacts/run-nl.json  (green only after e2e run passes)
  export-pw -> tests/e2e/**/*.spec.ts from .e2e/cache, then artifacts/e2e.json (origin replay-cache)
  kline     -> artifacts/kline.json and tests/kline/*.kline.json
`;
}

main().catch((error: unknown) => {
  if (error instanceof PipelineError) {
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
