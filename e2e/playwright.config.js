/* Browser tests against a running app - start it first: docker compose up -d.

   E2E_BASE_URL           where the app runs (default http://127.0.0.1:8080)
   E2E_REGISTRATION_CODE  the app's REGISTRATION_CODE; read from ../.env if unset

   Every test registers its own learner, so tests do not depend on each other
   or on existing accounts. They leave those accounts behind - run them
   against a local or test instance, not production. */
const fs = require("fs");
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

function fromDotEnv(name) {
  try {
    const line = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8")
      .split("\n").find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : undefined;
  } catch (e) {
    return undefined;
  }
}

process.env.E2E_REGISTRATION_CODE ??= fromDotEnv("REGISTRATION_CODE");

module.exports = defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:8080",
    locale: "de-DE",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
});
