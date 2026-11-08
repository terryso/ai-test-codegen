export const SCHEMA_VERSION = "1.0.0";

export type StepName = "explore" | "criteria" | "e2e" | "run-nl" | "export-pw" | "kline";

export type ActionName =
  | "goto"
  | "click"
  | "fill"
  | "assertVisible"
  | "assertText"
  | "assertUrl";

export interface TargetRef {
  name: string;
  baseUrl: string;
}

export interface ActionStep {
  action: ActionName;
  target: string;
  value: string | null;
}

export interface SiteConfig {
  name: string;
  baseUrl: string;
  scope: {
    includePaths: string[];
    maxPages: number;
  };
  auth: {
    loginUrl: string | null;
    usernameSelector: string | null;
    passwordSelector: string | null;
    submitSelector: string | null;
  };
}

export interface LoadedSite {
  config: SiteConfig;
  configPath: string;
  credentialsConfigured: boolean;
}

export interface PipelineOptions {
  dryRun: boolean;
  configPath?: string;
  artifactsDir: string;
  e2eDir: string;
  klineDir: string;
  nlDir: string;
  cacheDir: string;
}

export interface SelectorRecord {
  name: string;
  selector: string;
  role: string | null;
}

export interface PageRecord {
  id: string;
  url: string;
  path: string;
  title: string;
  selectors: SelectorRecord[];
}

export interface FlowRecord {
  id: string;
  name: string;
  entryUrl: string;
  steps: ActionStep[];
}

export interface AuthField {
  name: string;
  selector: string;
}

export interface ExploreArtifact {
  schemaVersion: typeof SCHEMA_VERSION;
  step: "explore";
  generatedAt: string;
  dryRun: boolean;
  target: TargetRef;
  pages: PageRecord[];
  flows: FlowRecord[];
  authSurface: {
    requiresAuth: boolean;
    loginUrl: string | null;
    fields: AuthField[];
    credentialsConfigured: boolean;
  };
  notes: string[];
}

export interface Assertion {
  type: "visible" | "text" | "url";
  target: string;
  expected: string;
}

export interface Criterion {
  id: string;
  title: string;
  sourceFlowId: string;
  priority: "must" | "should" | "may";
  preconditions: string[];
  steps: ActionStep[];
  assertions: Assertion[];
}

export interface CriteriaArtifact {
  schemaVersion: typeof SCHEMA_VERSION;
  step: "criteria";
  generatedAt: string;
  dryRun: boolean;
  sourceArtifact: string;
  target: TargetRef;
  criteria: Criterion[];
}

export interface E2ETestRecord {
  id: string;
  criteriaId: string;
  title: string;
  file: string;
  status: "passed" | "pending" | "failed";
  /** Set on replay-cache exports. The human-maintained NL file. */
  nlFile?: string;
  scenario: {
    steps: ActionStep[];
  };
}

export interface E2EArtifact {
  schemaVersion: typeof SCHEMA_VERSION;
  step: "e2e";
  generatedAt: string;
  dryRun: boolean;
  /**
   * `criteria` is the planning placeholder from acceptance criteria.
   * `replay-cache` is the production export from `.e2e/cache` after a green NL run.
   */
  origin?: "criteria" | "replay-cache";
  /** Replay cache directory used when origin is `replay-cache`. */
  cacheDir?: string;
  sourceArtifact: string;
  target: TargetRef;
  run: {
    runner: string;
    status: "green" | "pending" | "failed";
    attempts: number;
    note: string;
  };
  tests: E2ETestRecord[];
}

export interface RunNlArtifact {
  schemaVersion: typeof SCHEMA_VERSION;
  step: "run-nl";
  generatedAt: string;
  dryRun: boolean;
  status: "green" | "pending" | "failed";
  runner: string;
  cacheDir: string;
  files: string[];
  note: string;
}

export interface KlineCase {
  format: "kline";
  schemaVersion: typeof SCHEMA_VERSION;
  generatedBy: "ai-test-codegen";
  id: string;
  title: string;
  target: TargetRef;
  source: {
    criteriaId: string;
    e2eFile: string;
  };
  verifiedBy: string;
  steps: ActionStep[];
}

export interface KlineArtifact {
  schemaVersion: typeof SCHEMA_VERSION;
  step: "kline";
  generatedAt: string;
  dryRun: boolean;
  sourceArtifact: string;
  target: TargetRef;
  cases: Array<{
    id: string;
    file: string;
    sourceE2E: string;
    verifiedBy: string;
  }>;
}
