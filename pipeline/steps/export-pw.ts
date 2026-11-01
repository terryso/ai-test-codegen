import { loadSite } from "../config";
import { PipelineError } from "../errors";
import { readJsonFile, writeJsonFile } from "../fs";
import { artifactPath, displayPath, slugify } from "../paths";
import {
  SCHEMA_VERSION,
  type E2EArtifact,
  type PipelineOptions,
  type RunNlArtifact,
} from "../types";
import { ExportError, exportFromCache } from "../../scripts/export-playwright.mjs";

/**
 * Production Playwright export for human-maintained NL tests.
 *
 * Reads `artifacts/run-nl.json` and, only when that run is green, asks
 * `scripts/export-playwright.mjs` to turn `.e2e/cache` traces into
 * tests/e2e mirroring tests/nl (one spec per NL file).
 *
 * Playwright comes from exportFromCache and the replay cache.
 * The criteria placeholder in steps/e2e.ts is a different step and is not imported here.
 */
export async function runExportPw(options: PipelineOptions): Promise<E2EArtifact> {
  if (options.dryRun) {
    throw new PipelineError(
      "export-pw does not dry-run. It reads a green artifacts/run-nl.json and regenerates Playwright from .e2e/cache.",
    );
  }

  const site = await loadSite(options.configPath);
  const runNlPath = artifactPath(options.artifactsDir, "runNl");
  const runNl = await readJsonFile<RunNlArtifact>(runNlPath);
  if (runNl.step !== "run-nl") {
    throw new PipelineError(`${displayPath(runNlPath)} is not a run-nl artifact.`);
  }
  if (runNl.status !== "green") {
    throw new PipelineError(
      `NL run status is ${runNl.status} (${runNl.runner}). export-pw generates Playwright only from .e2e/cache after a green run-nl. ${runNl.note}`,
    );
  }

  let exported;
  try {
    exported = await exportFromCache({
      nlDir: options.nlDir,
      cacheDir: options.cacheDir,
      e2eDir: options.e2eDir,
      runNlPath,
    });
  } catch (error) {
    if (error instanceof ExportError || (error instanceof Error && error.name === "ExportError")) {
      throw new PipelineError(error.message);
    }
    throw error;
  }

  const used = new Set<string>();
  const tests: E2EArtifact["tests"] = [];
  for (const file of exported.files) {
    for (const testCase of file.tests) {
      const id = uniqueSlug(`${file.nlFile}-${testCase.title}`, used);
      tests.push({
        id,
        criteriaId: `${file.nlFile}#${testCase.title}`,
        title: testCase.title,
        file: displayPath(file.specFile),
        status: "passed",
        nlFile: file.nlFile,
        scenario: {
          steps: testCase.steps.map((step) => ({
            action: step.action,
            target: step.target,
            value: step.value,
          })),
        },
      });
    }
    console.log(`export-pw wrote ${displayPath(file.specFile)}`);
  }

  const artifact: E2EArtifact = {
    schemaVersion: SCHEMA_VERSION,
    step: "e2e",
    generatedAt: new Date().toISOString(),
    dryRun: false,
    origin: "replay-cache",
    cacheDir: displayPath(options.cacheDir),
    sourceArtifact: displayPath(runNlPath),
    target: { name: site.config.name, baseUrl: site.config.baseUrl },
    run: {
      runner: "replay-cache",
      status: "green",
      attempts: 1,
      note: "Specs were generated from .e2e/cache after a green NL run. Playwright itself was not executed in this step.",
    },
    tests,
  };

  const output = artifactPath(options.artifactsDir, "e2e");
  await writeJsonFile(output, artifact);
  console.log(`export-pw wrote ${displayPath(output)} status=green runner=replay-cache`);
  return artifact;
}

function uniqueSlug(id: string, used: Set<string>): string {
  const base = slugify(id);
  let slug = base;
  let index = 2;
  while (used.has(slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }
  used.add(slug);
  return slug;
}
