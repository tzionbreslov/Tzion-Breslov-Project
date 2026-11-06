import { defineConfig, devices } from "@playwright/test";

// Browser tests against the static export in out/, served like GitHub Pages
// with the enforced CSP (config/security-headers.mjs), so every test is also a
// CSP test. Run `npm run build` first; `npm run test:e2e` runs them.
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  // Heavy theme pages (GSAP, YouTube embeds) can take 10–25s on a busy machine.
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ],
  webServer: {
    command: "node scripts/serve-out.mjs out",
    url: `http://localhost:${PORT}/`,
    env: { PORT: String(PORT), SECURITY_HEADERS: "1" },
    reuseExistingServer: !process.env.CI
  }
});
