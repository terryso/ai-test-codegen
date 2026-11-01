import { loadSite } from "../config";
import { writeJsonFile } from "../fs";
import { artifactPath, displayPath } from "../paths";
import { SCHEMA_VERSION, type ExploreArtifact, type PipelineOptions } from "../types";

/** Crawl the target site into artifacts/explore.json. */
export async function runExplore(options: PipelineOptions): Promise<ExploreArtifact> {
  const site = await loadSite(options.configPath);
  const { config } = site;
  const entryPath = config.scope.includePaths[0] ?? "/";
  const entryUrl = new URL(entryPath, ensureTrailingSlash(config.baseUrl)).href;
  const notes: string[] = [];
  let pageUrl = entryUrl;
  let pagePath = new URL(entryUrl).pathname || "/";
  let title = `${config.name} home`;
  const selector = { name: "body", selector: "body", role: null };

  if (options.dryRun) {
    notes.push("Dry-run placeholder. No pages were crawled. The body selector is a stand-in until flow discovery exists.");
  } else {
    const response = await fetch(config.baseUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    pageUrl = response.url || entryUrl;
    pagePath = new URL(pageUrl).pathname || "/";
    title = titleMatch?.[1]?.trim() || title;
    notes.push(
      `Fetched ${config.baseUrl} (${response.status}). Selector and flow discovery are not implemented yet; this page record is a stub.`,
    );
    if (!response.ok) {
      notes.push(`Base URL responded with HTTP ${response.status}.`);
    }
  }

  const fields = [
    config.auth.usernameSelector
      ? { name: "username", selector: config.auth.usernameSelector }
      : null,
    config.auth.passwordSelector
      ? { name: "password", selector: config.auth.passwordSelector }
      : null,
    config.auth.submitSelector ? { name: "submit", selector: config.auth.submitSelector } : null,
  ].filter((field): field is { name: string; selector: string } => field !== null);

  const artifact: ExploreArtifact = {
    schemaVersion: SCHEMA_VERSION,
    step: "explore",
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    target: { name: config.name, baseUrl: config.baseUrl },
    pages: [
      {
        id: "page-home",
        url: pageUrl,
        path: pagePath,
        title,
        selectors: [selector],
      },
    ],
    flows: [
      {
        id: "flow-home-visible",
        name: `Open ${config.name}`,
        entryUrl: pageUrl,
        steps: [
          { action: "goto", target: pagePath || "/", value: null },
          { action: "assertVisible", target: selector.selector, value: null },
        ],
      },
    ],
    authSurface: {
      requiresAuth: Boolean(config.auth.loginUrl),
      loginUrl: config.auth.loginUrl,
      fields,
      credentialsConfigured: site.credentialsConfigured,
    },
    notes,
  };

  const output = artifactPath(options.artifactsDir, "explore");
  await writeJsonFile(output, artifact);
  console.log(`explore  wrote ${displayPath(output)} (${artifact.pages.length} page, ${artifact.flows.length} flow)`);
  return artifact;
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
