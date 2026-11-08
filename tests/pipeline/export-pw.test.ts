import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildE2eRunCommand } from "../../pipeline/steps/run-nl";
import { instructionDigest, mirrorSpecPath, parseNlTests } from "../../scripts/export-playwright.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const ACT = "Type the username and click the login button";

test("instruction digest matches e2e normalize-then-sha256", () => {
  assert.equal(
    instructionDigest("  hello\r\n"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

test("Sauce Demo NL files parse as human-maintained cases", async () => {
  const login = await readFile(path.join(repoRoot, "tests/nl/saucedemo/gen-01-login.e2e.ts"), "utf8");
  const cart = await readFile(path.join(repoRoot, "tests/nl/saucedemo/gen-02-add-to-cart.e2e.ts"), "utf8");
  const loginTests = parseNlTests(login);
  const cartTests = parseNlTests(cart);
  assert.equal(loginTests.length, 1);
  assert.equal(loginTests[0]?.title, "standard user reaches the inventory");
  assert.match(loginTests[0]?.body ?? "", /await agent\.act\(/);
  assert.match(loginTests[0]?.body ?? "", /await agent\.assert\(/);
  assert.equal(cartTests.length, 1);
  assert.equal((cartTests[0]?.body.match(/await agent\.act\(/g) ?? []).length, 2);
});

test("mirror path follows tests/nl to tests/e2e for Sauce Demo", () => {
  const spec = mirrorSpecPath(
    "tests/nl/saucedemo/gen-01-login.e2e.ts",
    "tests/nl",
    "tests/e2e",
  );
  assert.equal(spec.split(path.sep).join("/"), "tests/e2e/saucedemo/gen-01-login.spec.ts");
});

test("run-nl command targets the local e2e bin and the replay cache", () => {
  const command = buildE2eRunCommand(
    ["tests/nl/saucedemo/gen-01-login.e2e.ts"],
    ".e2e/cache",
    ".e2e",
  );
  assert.equal(command.command, process.execPath);
  assert.equal(command.args[1], "run");
  assert.ok(command.args.includes("tests/nl/saucedemo/gen-01-login.e2e.ts"));
  assert.ok(command.args.includes("--cache-dir"));
  assert.ok(command.args.includes(".e2e/cache"));
  assert.equal(command.args.includes("--no-cache"), false);
});

test("export-pw source does not call the criteria renderer", async () => {
  const source = await readFile(path.join(repoRoot, "pipeline/steps/export-pw.ts"), "utf8");
  assert.equal(/runE2E\s*\(/.test(source), false);
  assert.equal(source.includes("renderSpec"), false);
  assert.equal(source.includes('from "./e2e"'), false);
  assert.match(source, /exportFromCache/);
  assert.match(source, /\.e2e\/cache|cacheDir/);
});

test("run-nl dry-run stays pending and export-pw refuses it", async () => {
  const dirs = await makeDirs();
  try {
    await writeNl(dirs);
    const listed = await runCli(
      ["run-nl", "--dry-run", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(listed.code, 0, listed.stderr || listed.stdout);
    const runNl = await readJson(path.join(dirs.artifactsDir, "run-nl.json"));
    assert.equal(runNl.step, "run-nl");
    assert.equal(runNl.status, "pending");
    assert.equal(runNl.runner, "dry-run");

    const exported = await runCli(
      ["export-pw", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(exported.code, 1);
    assert.match(exported.stderr, /status is pending/i);
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("export-pw refuses a dry-run and a missing run-nl", async () => {
  const dirs = await makeDirs();
  try {
    const dry = await runCli(
      ["export-pw", "--dry-run", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(dry.code, 1);
    assert.match(dry.stderr, /does not dry-run/i);

    const missing = await runCli(
      ["export-pw", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /Missing/);
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("export-pw fails loud when the replay cache misses", async () => {
  const dirs = await makeDirs();
  try {
    await writeNl(dirs);
    await writeRunNl(dirs, "green");
    await writeCache(dirs, "0".repeat(64));
    const result = await runCli(
      ["export-pw", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no replay cache hit/i);
    await assert.rejects(readFile(path.join(dirs.e2eDir, "saucedemo", "gen-01-login.spec.ts"), "utf8"));
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("export-pw writes a mirrored spec from the cache and kline can store it", async () => {
  const dirs = await makeDirs();
  try {
    await writeNl(dirs);
    await writeRunNl(dirs, "green");
    await writeCache(dirs, instructionDigest(ACT));
    const result = await runCli(
      ["export-pw", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);

    const specPath = path.join(dirs.e2eDir, "saucedemo", "gen-01-login.spec.ts");
    const spec = await readFile(specPath, "utf8");
    assert.match(spec, /@generated pipeline:export-pw/);
    assert.equal(spec.includes("@generated pipeline:e2e"), false);
    assert.match(spec, /page\.getByRole\("button", \{ name: "LoginButtonFromCache" \}\)/);
    assert.match(spec, /page\.getByPlaceholder\("Username"\)/);
    assert.match(spec, /fill\("standard_user"\)/);
    assert.match(spec, /getByText\("Products", \{ exact: true \}\)/);
    assert.match(spec, /getByText\("Locked Out", \{ exact: true \}\)\)\.toHaveCount\(0\)/);
    assert.equal(spec.includes('locator("body")'), false);
    assert.match(spec, /page\.goto\("\/"\)/);

    const e2e = await readJson(path.join(dirs.artifactsDir, "e2e.json"));
    assert.equal(e2e.step, "e2e");
    assert.equal(e2e.origin, "replay-cache");
    assert.equal(e2e.run.status, "green");
    assert.equal(e2e.run.runner, "replay-cache");
    assert.equal(e2e.tests[0].status, "passed");
    assert.match(e2e.tests[0].nlFile, /saucedemo\/gen-01-login\.e2e\.ts$/);
    assert.match(e2e.tests[0].file, /saucedemo\/gen-01-login\.spec\.ts$/);
    const targets = e2e.tests[0].scenario.steps.map((step: { target: string }) => step.target);
    assert.ok(targets.some((target: string) => target.includes("LoginButtonFromCache")));
    const fills = e2e.tests[0].scenario.steps.filter((step: { action: string }) => step.action === "fill");
    assert.equal(fills[0].value, "standard_user");

    const kline = await runCli(
      ["kline", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(kline.code, 0, kline.stderr || kline.stdout);
    const index = await readJson(path.join(dirs.artifactsDir, "kline.json"));
    assert.equal(index.cases[0].verifiedBy, "replay-cache");
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("export-pw refuses a green run whose NL file has no replayable act", async () => {
  const dirs = await makeDirs();
  try {
    await mkdir(path.join(dirs.nlDir, "saucedemo"), { recursive: true });
    await writeFile(
      path.join(dirs.nlDir, "saucedemo", "gen-01-login.e2e.ts"),
      `import { test } from "e2e";
test("heading only", async ({ app, agent }) => {
  await app.open("/");
  await agent.assert("Check: the heading shows 「Products」");
});
`,
      "utf8",
    );
    await writeRunNl(dirs, "green");
    await mkdir(dirs.cacheDir, { recursive: true });
    const result = await runCli(
      ["export-pw", "--config", "config/site.example.json", ...dirArgs(dirs)],
      {},
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no replayed agent\.act/i);
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

interface Dirs {
  root: string;
  artifactsDir: string;
  e2eDir: string;
  klineDir: string;
  nlDir: string;
  cacheDir: string;
}

async function makeDirs(): Promise<Dirs> {
  const root = await mkdtemp(path.join(tmpdir(), "ai-test-codegen-export-"));
  return {
    root,
    artifactsDir: path.join(root, "artifacts"),
    e2eDir: path.join(root, "e2e"),
    klineDir: path.join(root, "kline"),
    nlDir: path.join(root, "nl"),
    cacheDir: path.join(root, "cache"),
  };
}

function dirArgs(dirs: Dirs): string[] {
  return [
    "--artifacts",
    dirs.artifactsDir,
    "--e2e-dir",
    dirs.e2eDir,
    "--kline-dir",
    dirs.klineDir,
    "--nl-dir",
    dirs.nlDir,
    "--cache-dir",
    dirs.cacheDir,
  ];
}

async function writeNl(dirs: Dirs): Promise<void> {
  const file = path.join(dirs.nlDir, "saucedemo", "gen-01-login.e2e.ts");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `import { test } from "e2e";

test("standard user reaches the inventory", async ({ app, agent }) => {
  await app.open("/");
  await agent.act(${JSON.stringify(ACT)});
  await agent.assert("Check: the heading shows 「Products」 and not 「Locked Out」");
});
`,
    "utf8",
  );
}

async function writeRunNl(dirs: Dirs, status: string): Promise<void> {
  await mkdir(dirs.artifactsDir, { recursive: true });
  const artifact = {
    schemaVersion: "1.0.0",
    step: "run-nl",
    generatedAt: "2026-11-01T00:00:00.000Z",
    dryRun: false,
    status,
    runner: "e2e",
    cacheDir: dirs.cacheDir,
    files: ["saucedemo/gen-01-login.e2e.ts"],
    note: "fixture",
  };
  await writeFile(path.join(dirs.artifactsDir, "run-nl.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

async function writeCache(dirs: Dirs, digest: string): Promise<void> {
  await mkdir(dirs.cacheDir, { recursive: true });
  const entry = {
    schemaVersion: "trace-1",
    createdAt: "2026-11-01T00:00:00.000Z",
    payload: {
      recordedFor: {
        testId: "ignored.e2e.ts::other",
        targetId: "web",
        instructionDigest: digest,
        callIndex: 0,
        agent: "default",
      },
      actions: [
        {
          name: "type",
          summary: "type standard_user into the username field",
          target: { role: "textbox", placeholder: "Username" },
          value: "standard_user",
        },
        {
          name: "tap",
          summary: "tap LoginButtonFromCache",
          target: { role: "button", name: "LoginButtonFromCache" },
        },
      ],
      summary: "Reached the inventory.",
      endAnchors: [{ text: "Products" }],
    },
  };
  await writeFile(path.join(dirs.cacheDir, "hit.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

function runCli(args: string[], extraEnv: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(repoRoot, "node_modules/.bin/tsx"), ["scripts/pipeline.ts", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DRY_RUN: "",
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
