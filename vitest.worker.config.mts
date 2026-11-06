import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: path.join(projectRoot, "wrangler.jsonc") },
      miniflare: {
        bindings: {
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
          // Svix-style secret (base64 after the whsec_ prefix) so signed webhooks can be tested end to end.
          RESEND_WEBHOOK_SECRET: "whsec_dGVzdC13ZWJob29rLXNpZ25pbmctc2VjcmV0"
        }
      }
    }))
  ],
  test: {
    include: ["worker/test/**/*.test.ts"],
    setupFiles: ["./worker/test/setup.ts"]
  }
});
