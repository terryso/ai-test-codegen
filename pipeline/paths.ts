import path from "node:path";

export const ARTIFACT_FILES = {
  explore: "explore.json",
  criteria: "criteria.json",
  e2e: "e2e.json",
  runNl: "run-nl.json",
  kline: "kline.json",
} as const;

export const DEFAULT_PATHS = {
  artifactsDir: "artifacts",
  e2eDir: "tests/e2e",
  klineDir: "tests/kline",
  nlDir: "tests/nl",
  cacheDir: ".e2e/cache",
} as const;

export const GENERATED_SPEC_MARKER = "@generated pipeline:e2e";
export const GENERATED_KLINE_BY = "ai-test-codegen";

export function artifactPath(artifactsDir: string, name: keyof typeof ARTIFACT_FILES): string {
  return path.join(artifactsDir, ARTIFACT_FILES[name]);
}

/** Path stored inside artifacts. Relative to the process cwd when possible. */
export function displayPath(filePath: string, cwd = process.cwd()): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(cwd, absolute);
  if (relative === "") {
    return ".";
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return absolute;
  }
  return relative.split(path.sep).join("/");
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "case";
}
