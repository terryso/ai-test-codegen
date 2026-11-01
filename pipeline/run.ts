import { runCriteria } from "./steps/criteria";
import { runE2E } from "./steps/e2e";
import { runExplore } from "./steps/explore";
import { runKline } from "./steps/kline";
import type { PipelineOptions, StepName } from "./types";

export async function runStep(step: StepName, options: PipelineOptions): Promise<void> {
  switch (step) {
    case "explore":
      await runExplore(options);
      return;
    case "criteria":
      await runCriteria(options);
      return;
    case "e2e":
      await runE2E(options);
      return;
    case "kline":
      await runKline(options);
      return;
    default:
      throw new Error(`Unknown step: ${String(step)}`);
  }
}

export async function runAll(options: PipelineOptions): Promise<void> {
  await runExplore(options);
  await runCriteria(options);
  await runE2E(options);
  await runKline(options);
}
