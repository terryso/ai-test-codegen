export const GENERATED_EXPORT_MARKER: "@generated pipeline:export-pw";

export class ExportError extends Error {
  constructor(message: string);
}

export type ReplayActionName = "goto" | "click" | "fill" | "assertVisible" | "assertText" | "assertUrl";

export interface ReplayStep {
  action: ReplayActionName;
  target: string;
  value: string | null;
}

export interface ExportedTest {
  title: string;
  steps: ReplayStep[];
}

export interface ExportedFile {
  nlFile: string;
  specFile: string;
  tests: ExportedTest[];
}

export interface ExportPlaywrightOptions {
  nlDir?: string;
  cacheDir?: string;
  e2eDir?: string;
  runNlPath?: string;
  nlFiles?: string[];
  titleFilter?: string;
}

export interface ExportPlaywrightResult {
  cacheDir: string;
  files: ExportedFile[];
}

export function normalizeInstruction(instruction: string): string;
export function instructionDigest(instruction: string): string;
export function mirrorSpecPath(nlFile: string, nlDir: string, e2eDir: string): string;
export function discoverNlFiles(nlDir: string): Promise<string[]>;
export function parseNlTests(source: string): Array<{ title: string; body: string }>;
export function exportFromCache(options: ExportPlaywrightOptions): Promise<ExportPlaywrightResult>;
