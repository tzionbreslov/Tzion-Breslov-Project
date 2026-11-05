import type { Env as WorkerEnv } from "../src/types";

// `env` from "cloudflare:workers" (and "cloudflare:test") is typed as Cloudflare.Env.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
