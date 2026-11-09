import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { unstable_readConfig } from "wrangler";
import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      // The Worker's own settings (entry point, compatibility date and flags, D1 binding, variables) come from
      // wrangler.jsonc, read here rather than through the plugin's `wrangler.configPath`. That path would also
      // load a developer's local .dev.vars (or, without one, process.env) for the secrets wrangler.jsonc declares,
      // and print "Missing required secrets" for each one it can't find there, although every binding a test uses
      // is given below. So the tests never see a local .dev.vars, and wrangler's real warnings stay where they
      // matter: `npm run worker:dev` and the deploy. Only the settings mapped below are carried over: a binding
      // type wrangler.jsonc gains later (KV, services, rate limits, Durable Objects…) reaches the tests only once
      // it is mapped here too, and a wrangler upgrade that renames `unstable_readConfig` fails this config loudly.
      const wrangler = unstable_readConfig({ config: path.join(projectRoot, "wrangler.jsonc") });
      return {
        main: wrangler.main,
        miniflare: {
          compatibilityDate: wrangler.compatibility_date,
          compatibilityFlags: wrangler.compatibility_flags,
          d1Databases: Object.fromEntries(wrangler.d1_databases.map((database) => [database.binding, database.database_id ?? database.binding])),
          bindings: {
            ...wrangler.vars,
            TEST_MIGRATIONS: await readD1Migrations(path.join(projectRoot, "worker/migrations")),
            ALLOWED_ORIGINS: "https://site.test",
            PUBLIC_API_URL: "https://api.test",
            SUBSCRIPTION_CONFIRMATION_REDIRECT_URL: "https://site.test/",
            ORGANIZATION_NAME: "Test Organization",
            TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
            TURNSTILE_EXPECTED_HOSTNAMES: "localhost",
            RATE_LIMIT_SALT: "test-only-rate-limit-salt-32-characters-long",
            RESEND_TRANSACTIONAL_API_KEY: "test-transactional-key",
            RESEND_CONTACTS_API_KEY: "test-contacts-key",
            RESEND_FROM_EMAIL: "Test Organization <no-reply@example.test>",
            // Optional; blank = no Reply-To (overrides the production value from wrangler.jsonc).
            // Tests that need one pass an env override.
            RESEND_REPLY_TO_EMAIL: "",
            CONTACT_TO_EMAIL: "team@example.test",
            RESEND_NEWSLETTER_TOPIC_ID: "topic_newsletter",
            RESEND_EVENTS_TOPIC_ID: "topic_events",
            // The site's /events.json, answered by the tests' fetch stub (worker/test/worker.test.ts).
            EVENTS_FEED_URL: "https://site.test/events.json",
            // Svix-style secret (base64 after the whsec_ prefix) so signed webhooks can be tested end to end.
            RESEND_WEBHOOK_SECRET: "whsec_dGVzdC13ZWJob29rLXNpZ25pbmctc2VjcmV0",
            // A fake number (555 is reserved for fiction); the real one is only ever a Worker secret.
            // PUBLIC_CONTACT_EMAIL comes from wrangler.jsonc's vars.
            CONTACT_PHONE: "+15555550123"
          }
        }
      };
    })
  ],
  test: {
    include: ["worker/test/**/*.test.ts"],
    setupFiles: ["./worker/test/setup.ts"]
  }
});
