import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { PipelineError } from "./errors";

export async function readJsonFile<T>(filePath: string): Promise<T> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      throw new PipelineError(
        `Missing ${filePath}. Run the previous pipeline step so this artifact exists.`,
      );
    }
    throw error;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PipelineError(`Artifact ${filePath} is not valid JSON.`);
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function removeGeneratedFiles(
  directory: string,
  suffix: string,
  marker: string,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isEnoent(error)) {
      return;
    }
    throw error;
  }
  await Promise.all(
    names
      .filter((name) => name.endsWith(suffix))
      .map(async (name) => {
        const fullPath = path.join(directory, name);
        const text = await readFile(fullPath, "utf8");
        if (text.includes(marker)) {
          await unlink(fullPath);
        }
      }),
  );
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
