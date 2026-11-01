import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PipelineError } from "../errors";
import { writeJsonFile } from "../fs";
import { artifactPath, displayPath } from "../paths";
import { SCHEMA_VERSION, type PipelineOptions, type RunNlArtifact } from "../types";
import { discoverNlFiles } from "../../scripts/export-playwright.mjs";

const NL_OUTPUT_DIR = ".e2e";

/**
 * Execute human-maintained tests under tests/nl with the e2e runner.
 *
 * A passing run settles replay traces in `.e2e/cache`. This step records that
 * outcome in `artifacts/run-nl.json`. It does not generate Playwright.
 * Dry-run lists the NL files and leaves status pending, so export-pw refuses it.
 */
export async function runNl(options: PipelineOptions): Promise<RunNlArtifact> {
  const files = await discoverNlFiles(options.nlDir);
  if (files.length === 0) {
    throw new PipelineError(
      `No NL tests under ${options.nlDir}. Add tests/nl/**/*.e2e.ts; humans maintain those files.`,
    );
  }

  const displayed = files.map((file) => displayPath(file));
  let status: RunNlArtifact["status"];
  let runner: string;
  let note: string;

  if (options.dryRun) {
    status = "pending";
    runner = "dry-run";
    note =
      "Dry-run lists NL files and does not execute them, so it does not settle .e2e/cache. export-pw will refuse this artifact until a live run-nl is green.";
  } else {
    const code = await spawnE2e(displayed, options.cacheDir, NL_OUTPUT_DIR);
    const report = await readReport(NL_OUTPUT_DIR);
    const reportStatus = report?.run?.status ?? "missing";
    runner = "e2e";
    if (code === 0 && reportStatus === "passed") {
      status = "green";
      note =
        "e2e run passed. Settled traces belong in .e2e/cache. export-pw reads that cache and does not render Playwright from criteria.";
    } else {
      status = "failed";
      note = `e2e run did not pass (exit ${code}, report ${reportStatus}). export-pw will refuse this artifact.`;
    }
  }

  const artifact: RunNlArtifact = {
    schemaVersion: SCHEMA_VERSION,
    step: "run-nl",
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    status,
    runner,
    cacheDir: displayPath(options.cacheDir),
    files: displayed,
    note,
  };
  const output = artifactPath(options.artifactsDir, "runNl");
  await writeJsonFile(output, artifact);
  console.log(`run-nl   wrote ${displayPath(output)} status=${status} runner=${runner} files=${displayed.length}`);
  return artifact;
}

export function resolveE2eBin(): string {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("e2e");
  const packageRoot = path.resolve(path.dirname(entry), "..");
  const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    bin?: { e2e?: string };
  };
  const relativeBin = pkg.bin?.e2e;
  if (!relativeBin) {
    throw new PipelineError("The installed e2e package has no CLI bin entry.");
  }
  return path.join(packageRoot, relativeBin);
}

export function buildE2eRunCommand(
  files: readonly string[],
  cacheDir: string,
  outputDir: string,
): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [resolveE2eBin(), "run", ...files, "--cache-dir", cacheDir, "--output", outputDir],
  };
}

function spawnE2e(files: readonly string[], cacheDir: string, outputDir: string): Promise<number> {
  const { command, args } = buildE2eRunCommand(files, cacheDir, outputDir);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, E2E_TELEMETRY_DISABLED: "1" },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

interface E2eReport {
  run?: { status?: string; exitCode?: number };
}

async function readReport(outputDir: string): Promise<E2eReport | undefined> {
  const reportPath = path.join(outputDir, "report.json");
  try {
    return JSON.parse(await readFile(reportPath, "utf8")) as E2eReport;
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw new PipelineError(`e2e report ${reportPath} is not valid JSON.`);
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
