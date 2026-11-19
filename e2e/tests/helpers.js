/* Setting up learners and their state through the same HTTP API the app uses.
   The browser context shares its cookies with context.request, so a learner
   registered here is logged in for every page of that context. */
const { expect } = require("@playwright/test");
const crypto = require("crypto");

const PASSWORD = "ein-langes-test-passwort";

async function csrf(context) {
  const cookie = (await context.cookies()).find((c) => c.name === "XSRF-TOKEN");
  return cookie ? cookie.value : "";
}

/** A call to /api as the logged-in learner. course: the X-Course header, as a tab would send it. */
async function api(context, method, route, data, course) {
  const headers = {};
  if (method !== "GET") headers["X-XSRF-TOKEN"] = await csrf(context);
  if (course) headers["X-Course"] = course;
  const res = await context.request.fetch(`/api/${route}`, { method, headers, data });
  expect(res.ok(), `${method} /api/${route}: ${res.status()} ${await res.text()}`).toBeTruthy();
  const type = res.headers()["content-type"] || "";
  return type.includes("json") ? res.json() : res.text();
}

/** Registers a fresh learner and logs them in. */
async function signUp(context, { course = "es" } = {}) {
  const code = process.env.E2E_REGISTRATION_CODE;
  if (!code) throw new Error("E2E_REGISTRATION_CODE is not set and .env has no REGISTRATION_CODE");
  const email = `e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await context.request.get("/api/auth/config");          // sets the CSRF cookie
  await api(context, "POST", "auth/register", { email, password: PASSWORD, code, course, displayName: "E2E" });
  return { email, password: PASSWORD, course };
}

/** The app's local day key, as app.js computes it. */
function todayKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Makes exactly these deck terms come up in the next session, as typing
 * drills: well-learned and due now, with no new cards mixed in.
 */
async function seedTypingDrill(context, terms, { direction = "es-de", course } = {}) {
  const now = Date.now();
  const cards = Object.fromEntries(terms.map((id) => [id, {
    id, state: "review", stability: 100, difficulty: 5, due: now - 60_000,
    lastReview: now - 30 * 86_400_000, reps: 5, lapses: 0, step: 0, interval: 30,
  }]));
  await api(context, "PATCH", "cards", cards, course);
  const { state } = await api(context, "GET", "snapshot", undefined, course);
  await api(context, "PUT", "state", {
    ...state, direction, dailyGoal: 20, newIntroducedOn: { [todayKey()]: 999 },
  }, course);
}

/**
 * Loads the app and waits until it is usable. The buttons exist in the HTML
 * before app.js has loaded the learner's data and attached its handlers.
 */
async function openApp(page) {
  await page.goto("/");
  await appReady(page);
}

/** The app has loaded its data and attached its handlers (boot sets data-ready). */
async function appReady(page) {
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 15_000 });
}

/* Where each screen is reached from: the four sections directly, trainers
   and lists through Üben, settings through the course button. */
const VIA_PRACTICE = new Set(["browse", "conj", "grammar", "packs"]);

/** Opens a screen the way a learner would. */
async function openTab(page, id) {
  if (id === "settings") {
    await page.locator("#courseBtn").click();
  } else if (VIA_PRACTICE.has(id)) {
    await page.locator("#tab-practice").click();
    await page.locator(`#view-practice [data-open="${id}"]`).click();
  } else if (id === "lesson") {
    await page.locator("#tab-home").click();
    await page.locator('[data-today="lesson"]').click();
  } else {
    await page.locator(`#tab-${id}`).click();
  }
  await expect(page.locator(`#view-${id}`)).toBeVisible();
}

module.exports = { api, signUp, seedTypingDrill, openApp, appReady, openTab, todayKey, PASSWORD };
