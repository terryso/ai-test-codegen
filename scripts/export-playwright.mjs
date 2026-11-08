#!/usr/bin/env node
// Playwright specs are generated from the e2e replay cache (.e2e/cache, trace-1)
// after a green NL run. The human source is tests/nl/**/*.e2e.ts.
//
// An agent.act is replayed only when its instruction digest hits a settled
// cache entry. Digest = SHA-256(normalizeInstruction(text)), the same rule as
// e2e 0.22 cache/identity.ts. agent.assert / agent.waitFor / observation acts
// become comments plus quoted-text expects. They are not a substitute for a
// cache hit: a file with no replayed act fails.
//
// This file does not read acceptance criteria and does not invent locators
// from the wording of the NL instruction.
//
// Usage:
//   node scripts/export-playwright.mjs [nlFile] [titleFilter]
//   npm run export-pw

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GENERATED_EXPORT_MARKER = "@generated pipeline:export-pw";

const DEFAULTS = {
  nlDir: "tests/nl",
  cacheDir: ".e2e/cache",
  e2eDir: "tests/e2e",
  runNlPath: "artifacts/run-nl.json",
};

export class ExportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExportError";
  }
}

/** CRLF/CR to LF, NFC, trim. Interior whitespace stays. Matches e2e normalizeInstruction. */
export function normalizeInstruction(instruction) {
  return instruction.replace(/\r\n?/gu, "\n").normalize("NFC").trim();
}

/** SHA-256 hex of the normalized instruction. Matches e2e instructionDigest. */
export function instructionDigest(instruction) {
  return createHash("sha256").update(normalizeInstruction(instruction), "utf8").digest("hex");
}

export function mirrorSpecPath(nlFile, nlDir, e2eDir) {
  const relative = path.relative(path.resolve(nlDir), path.resolve(nlFile));
  const safe = relative.startsWith("..") || path.isAbsolute(relative) ? path.basename(nlFile) : relative;
  return path.join(e2eDir, safe.replace(/\.e2e\.ts$/, ".spec.ts"));
}

export async function discoverNlFiles(nlDir) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".e2e.ts")) {
        found.push(fullPath);
      }
    }
  }
  await walk(nlDir);
  found.sort((left, right) => left.localeCompare(right));
  return found;
}

/**
 * Generate mirrored Playwright specs from `.e2e/cache`.
 * Writes nothing when a cache lookup fails.
 */
export async function exportFromCache(options) {
  const nlDir = options.nlDir ?? DEFAULTS.nlDir;
  const cacheDir = options.cacheDir ?? DEFAULTS.cacheDir;
  const e2eDir = options.e2eDir ?? DEFAULTS.e2eDir;
  const runNlPath = options.runNlPath ?? DEFAULTS.runNlPath;
  const titleFilter = options.titleFilter ?? "";
  await assertGreenRunNl(runNlPath);

  const nlFiles = options.nlFiles ?? (await discoverNlFiles(nlDir));
  if (nlFiles.length === 0) {
    throw new ExportError(
      `No NL tests under ${nlDir}. Humans maintain tests/nl/**/*.e2e.ts; export-pw only mirrors those files.`,
    );
  }

  const cache = await loadCache(cacheDir);
  const aliases = await loadValueAliases(nlFiles);
  const issues = [];
  const specs = [];
  for (const nlFile of nlFiles) {
    const built = await buildSpec(nlFile, nlDir, e2eDir, cache, aliases, titleFilter);
    issues.push(...built.issues);
    if (built.spec) {
      specs.push(built.spec);
    }
  }
  if (issues.length > 0) {
    throw new ExportError(
      `export-pw found no settled replay for ${issues.length} act(s). Playwright is not invented from criteria or from NL wording.\n${issues.join("\n")}`,
    );
  }
  if (specs.length === 0) {
    throw new ExportError("No NL tests matched. Nothing was written.");
  }

  await removeGeneratedSpecs(e2eDir);
  for (const spec of specs) {
    await mkdir(path.dirname(spec.specFile), { recursive: true });
    await writeFile(spec.specFile, spec.contents, "utf8");
  }
  return {
    cacheDir,
    files: specs.map((spec) => ({
      nlFile: spec.nlFile,
      specFile: spec.specFile,
      tests: spec.tests,
    })),
  };
}

async function assertGreenRunNl(runNlPath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(runNlPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new ExportError(
        `Missing ${runNlPath}. Run \`npm run run-nl\` until it writes status green and .e2e/cache has settled traces.`,
      );
    }
    throw new ExportError(`${runNlPath} is not valid JSON.`);
  }
  if (!parsed || parsed.step !== "run-nl" || parsed.status !== "green") {
    const status = parsed && typeof parsed.status === "string" ? parsed.status : "missing";
    const runner = parsed && typeof parsed.runner === "string" ? parsed.runner : "unknown";
    throw new ExportError(
      `NL run status is ${status} (${runner}). export-pw generates Playwright only from .e2e/cache after a green run-nl.`,
    );
  }
}

async function loadCache(cacheDir) {
  let names;
  try {
    names = await readdir(cacheDir);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new ExportError(
        `Replay cache directory ${cacheDir} does not exist. A green \`npm run run-nl\` settles traces there.`,
      );
    }
    throw error;
  }
  const entries = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const document = JSON.parse(await readFile(path.join(cacheDir, name), "utf8"));
      const recordedFor = document?.payload?.recordedFor;
      if (!recordedFor?.instructionDigest || !recordedFor?.testId) {
        continue;
      }
      if (document.schemaVersion && document.schemaVersion !== "trace-1") {
        continue;
      }
      entries.push({
        instructionDigest: recordedFor.instructionDigest,
        testId: String(recordedFor.testId),
        callIndex: typeof recordedFor.callIndex === "number" ? recordedFor.callIndex : undefined,
        createdAt: typeof document.createdAt === "string" ? document.createdAt : "",
        actions: Array.isArray(document.payload?.actions) ? document.payload.actions : [],
        endAnchors: Array.isArray(document.payload?.endAnchors) ? document.payload.endAnchors : [],
        summary: typeof document.payload?.summary === "string" ? document.payload.summary : "",
      });
    } catch {
      // Unreadable cache files are misses, not repaired inputs.
    }
  }
  return entries;
}

async function loadValueAliases(nlFiles) {
  const map = new Map();
  for (const nlFile of nlFiles) {
    const base = path.basename(nlFile).replace(/\.e2e\.ts$/, "");
    const overridePath = path.join("scripts", "export-overrides", `${base}.mjs`);
    try {
      const loaded = await import(pathToFileURL(path.resolve(overridePath)).href);
      const aliases = loaded.default?.valueAliases;
      map.set(nlFile, aliases && typeof aliases === "object" ? aliases : {});
    } catch (error) {
      if (error && error.code === "ERR_MODULE_NOT_FOUND") {
        map.set(nlFile, {});
        continue;
      }
      throw new ExportError(
        `Overrides failed to load (${overridePath}). Export stopped so a broken alias file cannot silently miss the cache. ${error instanceof Error ? error.message.split("\n")[0] : error}`,
      );
    }
  }
  return map;
}

async function buildSpec(nlFile, nlDir, e2eDir, cache, aliasesByFile, titleFilter) {
  const source = await readFile(nlFile, "utf8");
  const identity = nlIdentity(nlFile);
  const tests = parseNlTests(source).filter((testCase) => (titleFilter ? testCase.title.includes(titleFilter) : true));
  if (tests.length === 0) {
    return {
      issues: [`${identity}: no matching test${titleFilter ? ` for ${titleFilter}` : ""}`],
      spec: null,
    };
  }
  const aliases = aliasesByFile.get(nlFile) ?? {};
  const issues = [];
  const rendered = [];
  let replays = 0;
  for (const testCase of tests) {
    const parts = splitAgentCalls(testCase.body);
    const steps = [];
    const lines = [];
    const quoted = new Set();
    let actOrdinal = 0;
    const callIndexes = new Map();
    for (const part of parts) {
      if (part.kind === "code") {
        const code = transpileCode(part.text, steps);
        if (code.trim()) {
          lines.push(code.replace(/^\n/, "").replace(/\s+$/u, ""));
        }
        continue;
      }
      if (part.kind === "assert" || part.kind === "waitFor") {
        const projected = quoteAssertions(part.text, quoted);
        lines.push(`  // [${part.kind} ${actOrdinal}] ${excerpt(part.text)} [NL judgment; quoted text below was checked by the green run]`);
        lines.push(...projected.lines);
        steps.push(...projected.steps);
        actOrdinal += 1;
        continue;
      }
      const digestText = applyAliases(part.text, part.template, aliases);
      const digest = instructionDigest(digestText);
      const occurrence = callIndexes.get(digest) ?? 0;
      callIndexes.set(digest, occurrence + 1);
      if (isObservation(part.text)) {
        const projected = quoteAssertions(part.text, quoted);
        lines.push(`  // [observe ${actOrdinal}] ${excerpt(part.text)} [observation stays a comment]`);
        lines.push(...projected.lines);
        steps.push(...projected.steps);
        actOrdinal += 1;
        continue;
      }
      const hit = lookupCache(cache, { digest, title: testCase.title, nlFile: identity, callIndex: occurrence });
      if (!hit) {
        issues.push(
          `  ${identity} :: ${testCase.title}: no replay cache hit for agent.act ${excerpt(part.text)} digest=${digest.slice(0, 12)} cacheEntries=${cache.length}`,
        );
        actOrdinal += 1;
        continue;
      }
      const replay = transpileAct(hit, actOrdinal, part.text);
      lines.push(replay.comment);
      lines.push(...replay.lines);
      steps.push(...replay.steps);
      for (const issue of replay.issues) {
        issues.push(`  ${identity} :: ${testCase.title}: ${issue}`);
      }
      if (replay.issues.length === 0 && replay.lines.some((line) => line.includes("await "))) {
        replays += 1;
      } else if (replay.issues.length === 0) {
        issues.push(`  ${identity} :: ${testCase.title}: cache hit has no Playwright action (${excerpt(part.text)})`);
      }
      actOrdinal += 1;
    }
    rendered.push({ title: testCase.title, body: lines.filter((line) => line !== "").join("\n"), steps });
  }
  if (replays === 0) {
    issues.push(`  ${identity}: no replayed agent.act. Refusing to emit a spec from NL text alone.`);
  }
  if (issues.length > 0) {
    return { issues, spec: null };
  }
  const specFile = mirrorSpecPath(nlFile, nlDir, e2eDir);
  return {
    issues: [],
    spec: {
      nlFile: identity,
      specFile,
      tests: rendered.map((testCase) => ({ title: testCase.title, steps: testCase.steps })),
      contents: renderFile(identity, specFile, rendered),
    },
  };
}

function renderFile(nlFile, specFile, tests) {
  const regenerate = `npm run export-pw`;
  const header = [
    `// ${GENERATED_EXPORT_MARKER}`,
    `// Generated from the replay cache (.e2e/cache) of a green NL run.`,
    `// Human source: ${nlFile}`,
    `// Output: ${specFile.split(path.sep).join("/")}`,
    `// Regenerate: ${regenerate}`,
    `// Safe to delete. Do not hand-edit; the NL file is the source of truth.`,
    `import { expect, test } from "@playwright/test";`,
    "",
  ];
  const blocks = tests.map((testCase) => {
    return `test(${JSON.stringify(testCase.title)}, async ({ page }) => {\n${testCase.body}\n});`;
  });
  return `${header.join("\n")}\n${blocks.join("\n\n")}\n`;
}

function lookupCache(entries, query) {
  const hits = entries.filter((entry) => entry.instructionDigest === query.digest && entry.actions.length > 0);
  if (hits.length === 0) {
    return null;
  }
  const fileHits = hits.filter((entry) => belongsToFile(entry.testId, query.nlFile, query.title));
  let pool = fileHits.length > 0 ? fileHits : hits;
  const exactIndex = pool.filter((entry) => entry.callIndex === query.callIndex);
  const unindexed = pool.filter((entry) => entry.callIndex === undefined);
  if (exactIndex.length > 0) {
    pool = exactIndex;
  } else if (unindexed.length > 0) {
    pool = unindexed;
  } else {
    return null;
  }
  pool = [...pool].sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
  return pool[0] ?? null;
}

function belongsToFile(testId, nlFile, title) {
  const decoded = safeDecode(testId);
  return decoded.startsWith(`${nlFile}::`) && decoded.endsWith(`::${title}`);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function transpileAct(hit, ordinal, actText) {
  const lines = [];
  const steps = [];
  const issues = [];
  for (const action of hit.actions) {
    const rendered = transpileAction(action);
    if (rendered.issue) {
      issues.push(rendered.issue);
      lines.push(`  // ${rendered.issue}`);
      continue;
    }
    if (rendered.line) {
      lines.push(rendered.line);
    }
    if (rendered.step) {
      steps.push(rendered.step);
    }
  }
  const anchors = [];
  for (const anchor of hit.endAnchors) {
    const text = typeof anchor?.text === "string" ? anchor.text.trim() : "";
    if (text.length < 2 || anchors.includes(text)) {
      continue;
    }
    anchors.push(text);
    if (anchors.length === 6) {
      break;
    }
  }
  for (const text of anchors) {
    lines.push(`  await expect(page.getByText(${JSON.stringify(text)}).first()).toBeVisible();`);
    steps.push({ action: "assertText", target: "text", value: text });
  }
  const summary = hit.summary ? hit.summary.slice(0, 80) : "";
  return {
    comment: `  // [act ${ordinal}] ${excerpt(actText)} [recording: ${summary}]`,
    lines,
    steps,
    issues,
  };
}

function transpileAction(action) {
  const name = action?.name;
  if (name === "navigate") {
    const expression = jsReplayValue(action.url ?? "");
    return {
      line: `  await page.goto(${expression});`,
      step: { action: "goto", target: literalFromExpression(expression), value: null },
    };
  }
  if (name === "back") {
    return { line: "  await page.goBack();", step: { action: "goto", target: "history:back", value: null } };
  }
  if (name === "pressKey") {
    const expression = jsReplayValue(action.key ?? action.value ?? "Enter");
    return {
      line: `  await page.keyboard.press(${expression});`,
      step: { action: "click", target: "keyboard", value: literalFromExpression(expression) },
    };
  }
  if (name === "typeText") {
    const expression = jsReplayValue(action.value ?? "");
    const prefix = action.replace ? `  await page.keyboard.press("ControlOrMeta+A");\n` : "";
    return {
      line: `${prefix}  await page.keyboard.insertText(${expression});`,
      step: { action: "fill", target: "keyboard", value: scenarioValue(action.value) },
    };
  }
  if (name === "dismissKeyboard") {
    return { line: "  // dismissKeyboard has no Playwright equivalent in this exporter", step: null };
  }
  if (name === "tool") {
    return { line: null, step: null, issue: `tool gap cannot be replayed: ${action.summary ?? ""}` };
  }
  if (name === "scroll" || name === "scrollUntil") {
    const direction = typeof action.direction === "string" ? action.direction : "down";
    const delta = { down: [0, 600], up: [0, -600], left: [-600, 0], right: [600, 0] };
    const pair = delta[direction] ?? delta.down;
    const times = Number.isInteger(action.times) ? action.times : 1;
    const wheels = Array.from({ length: Math.min(times, 8) }, () => `  await page.mouse.wheel(${pair[0]}, ${pair[1]});`);
    if (name === "scrollUntil" && typeof action.text === "string") {
      wheels.push(`  await expect(page.getByText(${JSON.stringify(action.text)}).first()).toBeVisible();`);
    }
    return {
      line: wheels.join("\n"),
      step: { action: "click", target: `scroll:${direction}`, value: null },
    };
  }
  const locator = locatorOf(action.target);
  if (!locator) {
    return { line: `  // recorded ${name ?? "action"} has no target; skipped`, step: null };
  }
  if (name === "tap" || name === "longPress") {
    const delay = name === "longPress" ? "{ delay: 800 }" : "";
    return { line: `  await ${locator}.click(${delay});`, step: clickStep(locator) };
  }
  if (name === "doubleTap") {
    return { line: `  await ${locator}.dblclick();`, step: clickStep(locator) };
  }
  if (name === "secondaryTap") {
    return { line: `  await ${locator}.click({ button: "right" });`, step: clickStep(locator) };
  }
  if (name === "hover" || name === "scrollTo") {
    const method = name === "hover" ? "hover" : "scrollIntoViewIfNeeded";
    return { line: `  await ${locator}.${method}();`, step: clickStep(locator) };
  }
  if (name === "type") {
    return {
      line: `  await ${locator}.fill(${jsReplayValue(action.value ?? "")});`,
      step: { action: "fill", target: locator, value: scenarioValue(action.value) },
    };
  }
  if (name === "typeSecret") {
    const secret = String(action.secret ?? "");
    if (!/^[A-Z][A-Z0-9_]*$/.test(secret)) {
      return { line: null, step: null, issue: `typeSecret ${secret || "(unnamed)"} is not an env name; refusing to inline a secret` };
    }
    return {
      line: `  await ${locator}.fill(process.env.${secret} ?? "");`,
      step: { action: "fill", target: locator, value: `$ENV:${secret}` },
    };
  }
  if (name === "press") {
    const expression = jsReplayValue(action.key ?? action.value ?? "Enter");
    return {
      line: `  await ${locator}.press(${expression});`,
      step: { action: "click", target: locator, value: literalFromExpression(expression) },
    };
  }
  if (name === "select") {
    const expression = jsReplayValue(action.value ?? "");
    return {
      line: `  await ${locator}.selectOption(${expression});`,
      step: { action: "fill", target: locator, value: scenarioValue(action.value) },
    };
  }
  if (name === "check") {
    const method = action.checked === false ? "uncheck" : "check";
    return { line: `  await ${locator}.${method}();`, step: clickStep(locator) };
  }
  if (name === "upload" && Array.isArray(action.paths)) {
    return {
      line: `  await ${locator}.setInputFiles(${JSON.stringify(action.paths)});`,
      step: { action: "fill", target: locator, value: action.paths.join(",") },
    };
  }
  if (name === "drag" && action.destination) {
    const destination = locatorOf(action.destination);
    if (!destination) {
      return { line: "  // drag destination has no target; skipped", step: null };
    }
    return { line: `  await ${locator}.dragTo(${destination});`, step: clickStep(locator) };
  }
  if (name === "tapAt" || name === "hoverAt") {
    const point = action.point ?? {};
    const method = name === "hoverAt" ? "move" : "click";
    return {
      line: `  await page.mouse.${method}(${Number(point.x) || 0}, ${Number(point.y) || 0});`,
      step: { action: "click", target: `${name}:${point.x ?? 0},${point.y ?? 0}`, value: null },
    };
  }
  return { line: null, step: null, issue: `unsupported cache action ${name ?? "(missing)"}` };
}

function clickStep(locator) {
  return { action: "click", target: locator, value: null };
}

function locatorOf(target) {
  if (!target || typeof target !== "object") {
    return null;
  }
  let expression;
  if (typeof target.testId === "string" && target.testId) {
    expression = `page.getByTestId(${JSON.stringify(target.testId)})`;
  } else if (typeof target.role === "string" && typeof target.name === "string") {
    expression = `page.getByRole(${JSON.stringify(target.role)}, { name: ${JSON.stringify(target.name)} })`;
  } else if (typeof target.placeholder === "string" && target.placeholder) {
    expression = `page.getByPlaceholder(${JSON.stringify(target.placeholder)})`;
  } else if (typeof target.text === "string" && target.text) {
    expression = `page.getByText(${JSON.stringify(target.text)})`;
  } else if (typeof target.role === "string") {
    expression = `page.getByRole(${JSON.stringify(target.role)})`;
  } else {
    return null;
  }
  if (target.position && Number.isInteger(target.position.index)) {
    expression += `.nth(${target.position.index})`;
  }
  return expression;
}

function jsReplayValue(value) {
  const slot = /^\{\{param:\/([A-Za-z_][\w]*)(?:\|[^}]*)?\}\}$/u.exec(String(value));
  if (slot) {
    return slot[1];
  }
  return JSON.stringify(value ?? "");
}

function scenarioValue(value) {
  const slot = /^\{\{param:\/([A-Za-z_][\w]*)(?:\|[^}]*)?\}\}$/u.exec(String(value ?? ""));
  if (slot) {
    return `$PARAM:${slot[1]}`;
  }
  return value === undefined || value === null ? "" : String(value);
}

function literalFromExpression(expression) {
  const trimmed = expression.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote) && trimmed.length >= 2) {
    try {
      return JSON.parse(quote === "'" ? `"${trimmed.slice(1, -1)}"` : trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function quoteAssertions(actText, quoted) {
  const lines = [];
  const steps = [];
  const clauseBounds = (index) => {
    let start = 0;
    let end = actText.length;
    for (const delimiter of [",", "，", ";", "；", "。"]) {
      const previous = actText.lastIndexOf(delimiter, index);
      if (previous > start) {
        start = previous + 1;
      }
      const next = actText.indexOf(delimiter, index);
      if (next !== -1 && next < end) {
        end = next;
      }
    }
    return [start, end];
  };
  const negPrefix = /看不到|看不见|不再|没有|未出现|未显示|已消失|不存在|\bnot\b|\bwithout\b|does not|doesn't|no longer/iu;
  const negSuffix = /(?:字样|数值|一行)?\s*(?:没有|不再|未)出现|已消失|已?关闭|不存在|does not appear|is gone|is closed/iu;
  const quoteRe = /[「『]([^「」『』]+)[」』]/gu;
  let match;
  while ((match = quoteRe.exec(actText))) {
    const raw = match[1].trim();
    if (!raw || /^\d+$/u.test(raw) || raw.includes("{")) {
      continue;
    }
    const after = actText.slice(match.index + match[0].length, match.index + match[0].length + 12);
    const [clauseStart] = clauseBounds(match.index);
    const negative = negSuffix.test(after) || negPrefix.test(actText.slice(clauseStart, match.index));
    const key = `${negative ? "!" : ""}${raw}`;
    if (quoted.has(key)) {
      continue;
    }
    quoted.add(key);
    const expression = JSON.stringify(raw);
    if (negative) {
      lines.push(`  await expect(page.getByText(${expression}, { exact: true })).toHaveCount(0);`);
      steps.push({ action: "assertText", target: "text-absent", value: raw });
    } else {
      lines.push(`  await expect(page.getByText(${expression}, { exact: true })).toBeVisible();`);
      steps.push({ action: "assertText", target: "text", value: raw });
    }
  }
  return { lines, steps };
}

function transpileCode(chunk, steps) {
  const replaced = chunk.replace(/\bawait\s+app\.open\(\s*([^)]*)\)/gu, (_full, arg) => {
    const expression = arg.trim() === "" ? '"/"' : arg.trim();
    steps.push({ action: "goto", target: literalFromExpression(expression), value: null });
    return `await page.goto(${expression})`;
  });
  return replaced
    .replace(/\bawait\s+app\.back\(\s*\)/gu, "await page.goBack()")
    .replace(/\bscreen\b/gu, "page")
    .replace(/\bbrowser\b/gu, "page")
    .replace(/\bunique\((['"`])([^'"`]+)\1\)/gu, "$1$2$1");
}

function isObservation(text) {
  return /^(?:观察|observe\b)/iu.test(text.trim());
}

function applyAliases(text, template, aliases) {
  let next = text;
  if (template) {
    next = next.replace(/\$\{([^}]+)\}/gu, (_full, expr) => `{${String(expr).trim()}}`);
  }
  return next.replace(/\{([^}]+)\}/gu, (full, key) => (Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : full));
}

function excerpt(text) {
  return text.replace(/\s+/gu, " ").trim().slice(0, 90);
}

function nlIdentity(nlFile) {
  const relative = path.relative(process.cwd(), path.resolve(nlFile));
  const chosen = relative.startsWith("..") || path.isAbsolute(relative) ? path.resolve(nlFile) : relative;
  return chosen.split(path.sep).join("/");
}

export function parseNlTests(source) {
  const tests = [];
  let index = 0;
  while (index < source.length) {
    const found = source.indexOf("test(", index);
    if (found === -1) {
      break;
    }
    const previous = found > 0 ? source[found - 1] : "";
    if (/[A-Za-z0-9_.$]/u.test(previous)) {
      index = found + 5;
      continue;
    }
    const lineStart = source.lastIndexOf("\n", found) + 1;
    if (source.slice(lineStart, found).includes("//")) {
      index = found + 5;
      continue;
    }
    let cursor = skipWs(source, found + 5);
    const title = readString(source, cursor);
    if (!title) {
      index = found + 5;
      continue;
    }
    cursor = skipWs(source, title.end);
    if (source[cursor] === ",") {
      cursor = skipWs(source, cursor + 1);
      if (source[cursor] === "{") {
        const afterOptions = skipBalanced(source, cursor, "{", "}");
        if (afterOptions === undefined) {
          break;
        }
        cursor = skipWs(source, afterOptions);
        if (source[cursor] === ",") {
          cursor = skipWs(source, cursor + 1);
        }
      }
    }
    const arrow = source.indexOf("=>", cursor);
    const brace = arrow === -1 ? -1 : source.indexOf("{", arrow);
    if (brace === -1) {
      break;
    }
    const bodyEnd = skipBalanced(source, brace, "{", "}");
    if (bodyEnd === undefined) {
      break;
    }
    tests.push({ title: title.value, body: source.slice(brace + 1, bodyEnd - 1) });
    index = bodyEnd;
  }
  return tests;
}

function splitAgentCalls(body) {
  const parts = [];
  const pattern = /await\s+agent\.(act|assert|waitFor)\s*\(/gu;
  let last = 0;
  let match;
  while ((match = pattern.exec(body))) {
    parts.push({ kind: "code", text: body.slice(last, match.index) });
    const parsed = readAgentCall(body, pattern.lastIndex, match[1]);
    if (!parsed) {
      parts.push({ kind: "code", text: body.slice(match.index) });
      return parts;
    }
    parts.push(parsed.call);
    last = parsed.end;
    pattern.lastIndex = parsed.end;
  }
  parts.push({ kind: "code", text: body.slice(last) });
  return parts;
}

function readAgentCall(body, argsStart, kind) {
  const started = skipWs(body, argsStart);
  const literal = readString(body, started);
  const text = literal ? literal.value : "";
  const template = literal ? literal.quote === "`" : false;
  const end = skipCallFromInside(body, argsStart);
  if (end === undefined) {
    return undefined;
  }
  let cursor = end;
  if (body[cursor] === ";") {
    cursor += 1;
  }
  return { end: cursor, call: { kind, text, template } };
}

function readString(source, index) {
  const quote = source[index];
  if (quote !== "'" && quote !== '"' && quote !== "`") {
    return undefined;
  }
  let value = "";
  let cursor = index + 1;
  while (cursor < source.length) {
    const ch = source[cursor];
    if (ch === "\\") {
      const next = source[cursor + 1] ?? "";
      value += next === "n" ? "\n" : next === "t" ? "\t" : next;
      cursor += 2;
      continue;
    }
    if (ch === quote) {
      return { value, end: cursor + 1, quote };
    }
    value += ch;
    cursor += 1;
  }
  return undefined;
}

function skipWs(source, index) {
  let cursor = index;
  while (cursor < source.length && /\s/u.test(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function skipBalanced(source, index, open, close) {
  let depth = 0;
  let cursor = index;
  while (cursor < source.length) {
    const ch = source[cursor];
    if (ch === "'" || ch === '"' || ch === "`") {
      const literal = readString(source, cursor);
      if (!literal) {
        return undefined;
      }
      cursor = literal.end;
      continue;
    }
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
    cursor += 1;
  }
  return undefined;
}

function skipCallFromInside(source, index) {
  let depth = 1;
  let cursor = index;
  while (cursor < source.length) {
    const ch = source[cursor];
    if (ch === "'" || ch === '"' || ch === "`") {
      const literal = readString(source, cursor);
      if (!literal) {
        return undefined;
      }
      cursor = literal.end;
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
    cursor += 1;
  }
  return undefined;
}

async function removeGeneratedSpecs(directory) {
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith(".spec.ts")) {
        continue;
      }
      const text = await readFile(fullPath, "utf8");
      if (text.includes(GENERATED_EXPORT_MARKER)) {
        await unlink(fullPath);
      }
    }
  }
  await walk(directory);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const cli = parseCli(process.argv.slice(2));
  exportFromCache(cli)
    .then((result) => {
      for (const file of result.files) {
        console.log(`export-pw wrote ${file.specFile} (${file.tests.length} test)`);
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

function parseCli(argv) {
  const options = { ...DEFAULTS, nlFiles: undefined, titleFilter: "" };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--nl-dir" || token === "--cache" || token === "--out" || token === "--run-nl" || token === "--title") {
      const value = argv[index + 1];
      if (!value) {
        throw new ExportError(`${token} requires a value.`);
      }
      if (token === "--nl-dir") options.nlDir = value;
      if (token === "--cache") options.cacheDir = value;
      if (token === "--out") options.e2eDir = value;
      if (token === "--run-nl") options.runNlPath = value;
      if (token === "--title") options.titleFilter = value;
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      throw new ExportError(`Unknown argument ${token}.`);
    }
    positional.push(token);
  }
  if (positional[0]) {
    options.nlFiles = [positional[0]];
  }
  if (positional[1]) {
    options.titleFilter = positional[1];
  }
  return options;
}
