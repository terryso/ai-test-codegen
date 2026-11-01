import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { loadSite } from "../config";
import { PipelineError } from "../errors";
import { readJsonFile, removeGeneratedFiles, writeJsonFile } from "../fs";
import { GENERATED_SPEC_MARKER, artifactPath, displayPath, slugify } from "../paths";
import {
  SCHEMA_VERSION,
  type ActionStep,
  type CriteriaArtifact,
  type E2EArtifact,
  type PipelineOptions,
} from "../types";

/**
 * Planning placeholder: render Playwright from acceptance criteria.
 *
 * Production specs for human-maintained NL tests come from `runExportPw`,
 * which reads `.e2e/cache` after a green `run-nl`. This function is not that path.
 * Dry-run marks the placeholder run green without launching a browser.
 * The live path writes the placeholder specs and leaves the run pending.
 */
export async function runE2E(options: PipelineOptions): Promise<E2EArtifact> {
  const site = await loadSite(options.configPath);
  const sourcePath = artifactPath(options.artifactsDir, "criteria");
  const criteria = await readJsonFile<CriteriaArtifact>(sourcePath);
  if (criteria.step !== "criteria") {
    throw new PipelineError(`${displayPath(sourcePath)} is not a criteria artifact.`);
  }

  await mkdir(options.e2eDir, { recursive: true });
  await removeGeneratedFiles(options.e2eDir, ".spec.ts", GENERATED_SPEC_MARKER);

  const used = new Set<string>();
  const tests: E2EArtifact["tests"] = [];
  for (const criterion of criteria.criteria) {
    const slug = uniqueSlug(criterion.id, used);
    const fileName = `${slug}.spec.ts`;
    const absolute = path.join(options.e2eDir, fileName);
    await writeFile(absolute, renderSpec(criterion.title, criterion.id, criterion.steps), "utf8");
    tests.push({
      id: criterion.id,
      criteriaId: criterion.id,
      title: criterion.title,
      file: displayPath(absolute),
      status: options.dryRun ? "passed" : "pending",
      scenario: { steps: criterion.steps.map((step) => ({ ...step })) },
    });
  }

  const run: E2EArtifact["run"] = options.dryRun
    ? {
        runner: "dry-run",
        status: "green",
        attempts: tests.length === 0 ? 0 : 1,
        note: "Browser was not launched. Status is a placeholder so later steps can be demonstrated.",
      }
    : {
        runner: "agent-stub",
        status: "pending",
        attempts: 0,
        note: "Specs were written. The agent loop that runs them until green is not implemented. Re-run with --dry-run to simulate a green result.",
      };

  const artifact: E2EArtifact = {
    schemaVersion: SCHEMA_VERSION,
    step: "e2e",
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    origin: "criteria",
    sourceArtifact: displayPath(sourcePath),
    target: { name: site.config.name, baseUrl: site.config.baseUrl },
    run,
    tests,
  };

  const output = artifactPath(options.artifactsDir, "e2e");
  await writeJsonFile(output, artifact);
  for (const test of tests) {
    console.log(`e2e      wrote ${test.file}`);
  }
  console.log(`e2e      wrote ${displayPath(output)} status=${run.status} runner=${run.runner}`);
  return artifact;
}

function renderSpec(title: string, criteriaId: string, steps: ActionStep[]): string {
  const body = steps.map((step) => renderStep(step)).join("\n");
  return `import { expect, test } from "@playwright/test";

// ${GENERATED_SPEC_MARKER}
// criterion: ${criteriaId}
test(${JSON.stringify(title)}, async ({ page }) => {
${body}
});
`;
}

function renderStep(step: ActionStep): string {
  const target = JSON.stringify(step.target);
  const value = JSON.stringify(step.value ?? "");
  switch (step.action) {
    case "goto":
      return `  await page.goto(${target});`;
    case "click":
      return `  await page.locator(${target}).click();`;
    case "fill":
      // Values that name an env var stay out of the file. The generator never inlines secrets.
      if (step.value?.startsWith("$ENV:")) {
        const envName = step.value.slice("$ENV:".length).replace(/[^A-Z0-9_]/gi, "");
        return `  await page.locator(${target}).fill(process.env.${envName} ?? "");`;
      }
      return `  await page.locator(${target}).fill(${value});`;
    case "assertVisible":
      return `  await expect(page.locator(${target})).toBeVisible();`;
    case "assertText":
      return `  await expect(page.locator(${target})).toContainText(${value});`;
    case "assertUrl":
      return `  await expect(page).toHaveURL(${JSON.stringify(step.value ?? step.target)});`;
    default:
      return `  // unsupported action ${JSON.stringify(step.action)}`;
  }
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
