const { test, expect } = require("@playwright/test");
const { api, signUp, openApp, appReady, openTab } = require("./helpers");

/** The X-Course header of every /api request the page makes. */
function courseHeaders(page) {
  const seen = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/") && !r.url().includes("/api/stream")) {
      seen.push(r.headers()["x-course"]);
    }
  });
  return seen;
}

test("switching the course reloads the app in the other language", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await expect(page).toHaveTitle("Español – Vokabeltrainer");

  await openTab(page, "settings");
  await page.locator("#courseSelect").selectOption("en");
  await expect(page).toHaveTitle("English – Vokabeltrainer");
  await appReady(page);
  expect((await api(context, "GET", "auth/me")).course).toBe("en");
});

test("a tab left open on the old course keeps writing into its own course", async ({ context }) => {
  await signUp(context, { course: "es" });
  const laptop = await context.newPage();
  const phone = await context.newPage();
  await openApp(laptop);
  await openApp(phone);
  const phoneHeaders = courseHeaders(phone);

  // Switch on the laptop; the phone still shows Spanish.
  await openTab(laptop, "settings");
  await laptop.locator("#courseSelect").selectOption("en");
  await expect(laptop).toHaveTitle("English – Vokabeltrainer");

  await phone.locator("#startSessionBtn").click();
  const term = (await phone.locator("#flipFront").textContent()).trim();
  await phone.locator("#flashcard").click();
  const logged = phone.waitForResponse((r) => r.url().endsWith("/api/events") && r.request().method() === "POST");
  await phone.locator('.grade-btn[data-grade="3"]').click();
  await logged;

  expect(phoneHeaders.length).toBeGreaterThan(0);
  expect(new Set(phoneHeaders)).toEqual(new Set(["es"]));
  expect((await api(context, "GET", "events", undefined, "es")).map((e) => e.id)).toEqual([term]);
  expect(await api(context, "GET", "events", undefined, "en")).toEqual([]);
});
