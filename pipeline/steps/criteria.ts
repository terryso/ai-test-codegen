import { loadSite } from "../config";
import { PipelineError } from "../errors";
import { readJsonFile, writeJsonFile } from "../fs";
import { artifactPath, displayPath } from "../paths";
import {
  SCHEMA_VERSION,
  type ActionStep,
  type Assertion,
  type CriteriaArtifact,
  type ExploreArtifact,
  type PipelineOptions,
} from "../types";

/** Turn an explore artifact into acceptance criteria. */
export async function runCriteria(options: PipelineOptions): Promise<CriteriaArtifact> {
  const site = await loadSite(options.configPath);
  const sourcePath = artifactPath(options.artifactsDir, "explore");
  const explore = await readJsonFile<ExploreArtifact>(sourcePath);
  if (explore.step !== "explore") {
    throw new PipelineError(`${displayPath(sourcePath)} is not an explore artifact.`);
  }

  const criteria = explore.flows.map((flow) => {
    const steps = flow.steps.map((step) => ({ ...step }));
    const assertions = assertionsFromSteps(steps);
    if (assertions.length === 0) {
      const expected = flow.entryUrl;
      steps.push({ action: "assertUrl", target: expected, value: expected });
      assertions.push({ type: "url", target: expected, expected });
    }
    const preconditions = explore.authSurface.requiresAuth ? ["A signed-in session is available."] : [];
    return {
      id: `AC-${flow.id}`,
      title: flow.name,
      sourceFlowId: flow.id,
      priority: "must" as const,
      preconditions,
      steps,
      assertions,
    };
  });

  const artifact: CriteriaArtifact = {
    schemaVersion: SCHEMA_VERSION,
    step: "criteria",
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    sourceArtifact: displayPath(sourcePath),
    target: { name: site.config.name, baseUrl: site.config.baseUrl },
    criteria,
  };

  const output = artifactPath(options.artifactsDir, "criteria");
  await writeJsonFile(output, artifact);
  console.log(`criteria wrote ${displayPath(output)} (${artifact.criteria.length} criterion)`);
  return artifact;
}

function assertionsFromSteps(steps: ActionStep[]): Assertion[] {
  const assertions: Assertion[] = [];
  for (const step of steps) {
    if (step.action === "assertVisible") {
      assertions.push({ type: "visible", target: step.target, expected: "visible" });
    } else if (step.action === "assertText") {
      assertions.push({ type: "text", target: step.target, expected: step.value ?? "" });
    } else if (step.action === "assertUrl") {
      assertions.push({ type: "url", target: step.target, expected: step.value ?? step.target });
    }
  }
  return assertions;
}
