import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

/**
 * Runner config for human-maintained tests under tests/nl.
 * Cache mode is explicit read-write: an ambient CI variable would otherwise
 * demote an unset mode to read-only and a green run would settle nothing.
 * Model credentials stay in the environment; see https://e2e.tester.army/docs/quickstart.
 */
const config = {
  projectId: "ai-test-codegen",
  tests: ["tests/nl/**/*.e2e.ts"],
  retries: 0,
  workers: 1,
  cache: {
    mode: "read-write",
    dir: ".e2e/cache",
  },
  targets: [
    {
      name: "saucedemo",
      engine: web(),
      app: {
        url: "https://www.saucedemo.com",
        identity: "saucedemo",
        environment: "test",
      },
    },
  ],
} satisfies E2EConfig;

export default config;
