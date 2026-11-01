import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { PipelineError } from "./errors";
import type { LoadedSite, SiteConfig } from "./types";

const DEFAULT_EXAMPLE = "config/site.example.json";

export function resolveConfigPath(explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  if (process.env.SITE_CONFIG) {
    return process.env.SITE_CONFIG;
  }
  if (existsSync("config/site.json")) {
    return "config/site.json";
  }
  return DEFAULT_EXAMPLE;
}

export async function loadSite(explicitPath?: string): Promise<LoadedSite> {
  const configPath = resolveConfigPath(explicitPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (isEnoent(error)) {
      throw new PipelineError(
        `Site config not found at ${configPath}. Copy config/site.example.json to config/site.json.`,
      );
    }
    throw new PipelineError(`Site config ${configPath} is not valid JSON.`);
  }
  const config = applyEnv(normalizeSiteConfig(parsed, configPath));
  return {
    config,
    configPath,
    credentialsConfigured: Boolean(process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD),
  };
}

function normalizeSiteConfig(value: unknown, configPath: string): SiteConfig {
  if (typeof value !== "object" || value === null) {
    throw new PipelineError(`Site config ${configPath} must be a JSON object.`);
  }
  const record = value as Record<string, unknown>;
  const scope = asRecord(record.scope, "scope");
  const auth = asRecord(record.auth, "auth");
  const includePaths = Array.isArray(scope.includePaths)
    ? scope.includePaths.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const config: SiteConfig = {
    name: requiredString(record.name, "name"),
    baseUrl: requiredString(record.baseUrl, "baseUrl"),
    scope: {
      includePaths: includePaths.length > 0 ? includePaths : ["/"],
      maxPages: positiveInt(scope.maxPages, 20),
    },
    auth: {
      loginUrl: optionalString(auth.loginUrl),
      usernameSelector: optionalString(auth.usernameSelector),
      passwordSelector: optionalString(auth.passwordSelector),
      submitSelector: optionalString(auth.submitSelector),
    },
  };
  assertHttpUrl(config.baseUrl, "baseUrl");
  if (config.auth.loginUrl) {
    assertHttpUrl(config.auth.loginUrl, "auth.loginUrl");
  }
  return config;
}

function applyEnv(config: SiteConfig): SiteConfig {
  const next: SiteConfig = {
    ...config,
    scope: { ...config.scope },
    auth: { ...config.auth },
  };
  if (process.env.TARGET_NAME?.trim()) {
    next.name = process.env.TARGET_NAME.trim();
  }
  if (process.env.TARGET_URL?.trim()) {
    next.baseUrl = stripUserInfo(process.env.TARGET_URL.trim());
    assertHttpUrl(next.baseUrl, "TARGET_URL");
  } else {
    next.baseUrl = stripUserInfo(next.baseUrl);
  }
  if (process.env.AUTH_LOGIN_URL?.trim()) {
    next.auth.loginUrl = stripUserInfo(process.env.AUTH_LOGIN_URL.trim());
    assertHttpUrl(next.auth.loginUrl, "AUTH_LOGIN_URL");
  }
  if (process.env.AUTH_USERNAME_SELECTOR?.trim()) {
    next.auth.usernameSelector = process.env.AUTH_USERNAME_SELECTOR.trim();
  }
  if (process.env.AUTH_PASSWORD_SELECTOR?.trim()) {
    next.auth.passwordSelector = process.env.AUTH_PASSWORD_SELECTOR.trim();
  }
  if (process.env.AUTH_SUBMIT_SELECTOR?.trim()) {
    next.auth.submitSelector = process.env.AUTH_SUBMIT_SELECTOR.trim();
  }
  return next;
}

export function stripUserInfo(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return raw;
  }
}

function assertHttpUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PipelineError(`${label} must be an absolute http(s) URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PipelineError(`${label} must use http or https.`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PipelineError(`Site config field ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PipelineError(`Site config field ${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
