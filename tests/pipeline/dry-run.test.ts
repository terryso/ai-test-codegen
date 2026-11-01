import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SECRET = "super-secret-value";
const USERNAME = "demo-user";

test("dry-run pipeline writes the four artifacts and a Kline case", async () => {
  const dirs = await makeDirs();
  try {
    const result = await runCli(
      ["all", "--dry-run", "--config", "config/site.example.json", ...dirArgs(dirs)],
      { TARGET_URL: "https://user:pass@example.com/home" },
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);

    const explore = await readJson(path.join(dirs.artifactsDir, "explore.json"));
    const criteria = await readJson(path.join(dirs.artifactsDir, "criteria.json"));
    const e2e = await readJson(path.join(dirs.artifactsDir, "e2e.json"));
    const kline = await readJson(path.join(dirs.artifactsDir, "kline.json"));

    assert.equal(explore.step, "explore");
    assert.equal(explore.dryRun, true);
    assert.equal(explore.target.baseUrl, "https://example.com/home");
    assert.equal(explore.authSurface.credentialsConfigured, true);
    assert.equal(explore.flows[0].id, "flow-home-visible");

    assert.equal(criteria.step, "criteria");
    assert.equal(criteria.criteria[0].id, "AC-flow-home-visible");
    assert.equal(criteria.criteria[0].sourceFlowId, "flow-home-visible");

    assert.equal(e2e.step, "e2e");
    assert.equal(e2e.run.status, "green");
    assert.equal(e2e.run.runner, "dry-run");
    assert.equal(e2e.tests[0].status, "passed");

    const spec = await readFile(path.join(dirs.e2eDir, "ac-flow-home-visible.spec.ts"), "utf8");
    assert.match(spec, /@generated pipeline:e2e/);
    assert.match(spec, /page\.goto\("\/"\)/);
    assert.match(spec, /locator\("body"\)/);
    assert.match(spec, /toBeVisible\(\)/);

    assert.equal(kline.step, "kline");
    assert.equal(kline.cases[0].verifiedBy, "dry-run");
    const klineCase = await readJson(path.join(dirs.klineDir, "ac-flow-home-visible.kline.json"));
    assert.equal(klineCase.format, "kline");
    assert.equal(klineCase.generatedBy, "ai-test-codegen");
    assert.deepEqual(klineCase.steps, e2e.tests[0].scenario.steps);

    const dumped = [
      JSON.stringify(explore),
      JSON.stringify(criteria),
      JSON.stringify(e2e),
      JSON.stringify(kline),
      JSON.stringify(klineCase),
      spec,
      result.stdout,
      result.stderr,
    ].join("\n");
    assert.equal(dumped.includes(SECRET), false);
    assert.equal(dumped.includes(USERNAME), false);
    assert.equal(dumped.includes("user:pass"), false);
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("kline refuses a run that is not green", async () => {
  const dirs = await makeDirs();
  try {
    const first = await runCli(
      ["all", "--dry-run", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(first.code, 0, first.stderr || first.stdout);
    const e2ePath = path.join(dirs.artifactsDir, "e2e.json");
    const e2e = await readJson(e2ePath);
    e2e.run.status = "pending";
    e2e.run.runner = "agent-stub";
    e2e.run.note = "forced pending for the refusal check";
    await writeFile(e2ePath, `${JSON.stringify(e2e, null, 2)}\n`, "utf8");

    const second = await runCli(
      ["kline", "--dry-run", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(second.code, 1);
    assert.match(second.stderr, /not green|status is pending/i);
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("criteria fails when the explore artifact is missing", async () => {
  const dirs = await makeDirs();
  try {
    const result = await runCli(
      ["criteria", "--dry-run", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Missing/);
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

interface Dirs {
  root: string;
  artifactsDir: string;
  e2eDir: string;
  klineDir: string;
}

async function makeDirs(): Promise<Dirs> {
  const root = await mkdtemp(path.join(tmpdir(), "ai-test-codegen-"));
  return {
    root,
    artifactsDir: path.join(root, "artifacts"),
    e2eDir: path.join(root, "e2e"),
    klineDir: path.join(root, "kline"),
  };
}

function dirArgs(dirs: Dirs): string[] {
  return ["--artifacts", dirs.artifactsDir, "--e2e-dir", dirs.e2eDir, "--kline-dir", dirs.klineDir];
}

function runCli(args: string[], extraEnv: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(repoRoot, "node_modules/.bin/tsx"), ["scripts/pipeline.ts", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DRY_RUN: "",
        AUTH_USERNAME: USERNAME,
        AUTH_PASSWORD: SECRET,
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function readJson(filePath: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, any>;
}
