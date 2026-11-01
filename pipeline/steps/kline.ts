import path from "node:path";

import { loadSite } from "../config";
import { PipelineError } from "../errors";
import { readJsonFile, removeGeneratedFiles, writeJsonFile } from "../fs";
import { GENERATED_KLINE_BY, artifactPath, displayPath, slugify } from "../paths";
import {
  SCHEMA_VERSION,
  type E2EArtifact,
  type KlineArtifact,
  type KlineCase,
  type PipelineOptions,
} from "../types";

/**
 * Convert a green E2E run into Kline cases under tests/kline/.
 * Kline is the durable, runner-agnostic sink. This stub copies the structured
 * scenario from the E2E artifact; it does not parse the Playwright spec.
 */
export async function runKline(options: PipelineOptions): Promise<KlineArtifact> {
  const site = await loadSite(options.configPath);
  const sourcePath = artifactPath(options.artifactsDir, "e2e");
  const e2e = await readJsonFile<E2EArtifact>(sourcePath);
  if (e2e.step !== "e2e") {
    throw new PipelineError(`${displayPath(sourcePath)} is not an E2E artifact.`);
  }
  if (e2e.run.status !== "green") {
    throw new PipelineError(
      `E2E run status is ${e2e.run.status} (${e2e.run.runner}). Kline only stores green runs. ${e2e.run.note}`,
    );
  }

  await removeGeneratedFiles(options.klineDir, ".kline.json", `"generatedBy": "${GENERATED_KLINE_BY}"`);

  const used = new Set<string>();
  const cases: KlineArtifact["cases"] = [];
  for (const test of e2e.tests) {
    if (test.status !== "passed") {
      continue;
    }
    const slug = uniqueSlug(test.id, used);
    const absolute = path.join(options.klineDir, `${slug}.kline.json`);
    const klineCase: KlineCase = {
      format: "kline",
      schemaVersion: SCHEMA_VERSION,
      generatedBy: GENERATED_KLINE_BY,
      id: test.id,
      title: test.title,
      target: { name: site.config.name, baseUrl: site.config.baseUrl },
      source: { criteriaId: test.criteriaId, e2eFile: test.file },
      verifiedBy: e2e.run.runner,
      steps: test.scenario.steps.map((step) => ({ ...step })),
    };
    await writeJsonFile(absolute, klineCase);
    cases.push({
      id: test.id,
      file: displayPath(absolute),
      sourceE2E: test.file,
      verifiedBy: e2e.run.runner,
    });
  }

  const artifact: KlineArtifact = {
    schemaVersion: SCHEMA_VERSION,
    step: "kline",
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    sourceArtifact: displayPath(sourcePath),
    target: { name: site.config.name, baseUrl: site.config.baseUrl },
    cases,
  };
  const output = artifactPath(options.artifactsDir, "kline");
  await writeJsonFile(output, artifact);
  for (const item of cases) {
    console.log(`kline    wrote ${item.file}`);
  }
  console.log(`kline    wrote ${displayPath(output)} (${cases.length} case)`);
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
