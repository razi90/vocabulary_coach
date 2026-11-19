const { test, expect } = require("@playwright/test");
const { signUp, appReady, openTab, PASSWORD } = require("./helpers");
const crypto = require("crypto");

test("the app sends anonymous visitors to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/login\.html/);
  await expect(page.locator("#loginForm")).toBeVisible();
});

test("a wrong password is refused with a message", async ({ page }) => {
  await page.goto("/login.html");
  // A fresh address each run: ten failures for one address lock it (LoginThrottle).
  await page.locator('#loginForm input[name="email"]').fill(`nobody-${crypto.randomUUID().slice(0, 8)}@example.com`);
  await page.locator('#loginForm input[name="password"]').fill("falsches-passwort");
  await page.locator('#loginForm button[type="submit"]').click();
  await expect(page.locator("#authError")).toHaveText("E-Mail oder Passwort stimmt nicht.");
  await expect(page).toHaveURL(/login\.html/);
});

test("register, pick English as the first step, log out, log back in @phone", async ({ page }) => {
  const email = `e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await page.goto("/login.html");
  await page.locator("#toRegister a").click();
  const form = page.locator("#registerForm");
  await expect(form).toBeVisible();
  await form.locator('input[name="displayName"]').fill("E2E");
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.locator('input[name="code"]').fill(process.env.E2E_REGISTRATION_CODE);
  await form.locator('button[type="submit"]').click();

  // The first thing a new learner does: choose the language.
  await appReady(page);
  await expect(page.locator('.welcome-step[data-step="1"] h1')).toHaveText("Welche Sprache möchtest du lernen?");
  await page.locator('#welcomeCourses .choice[data-course="en"]').click();
  await page.locator("#welcomeNext").click();
  await expect(page).toHaveTitle("English – Vokabeltrainer");
  await appReady(page);
  await expect(page.locator('.welcome-step[data-step="2"] h1')).toHaveText("Jeden Tag ein bisschen Englisch.");
  await page.locator("#welcomeSkip").click();
  await expect(page.locator("#view-home")).toBeVisible();

  await openTab(page, "settings");
  await expect(page.locator("#accountEmail")).toContainText(email);
  await page.locator("#logoutBtn").click();
  await expect(page).toHaveURL(/login\.html/);

  await page.locator('#loginForm input[name="email"]').fill(email);
  await page.locator('#loginForm input[name="password"]').fill(PASSWORD);
  await page.locator('#loginForm button[type="submit"]').click();
  await expect(page).toHaveTitle("English – Vokabeltrainer");
  await appReady(page);
});

test("a short password is refused at registration", async ({ page }) => {
  await page.goto("/login.html#registrieren");
  const form = page.locator("#registerForm");
  await expect(form).toBeVisible();
  await form.locator('input[name="email"]').fill(`e2e-${crypto.randomUUID().slice(0, 8)}@example.com`);
  await form.locator('input[name="password"]').fill("kurz");
  await form.locator('input[name="code"]').fill(process.env.E2E_REGISTRATION_CODE);
  await form.locator('button[type="submit"]').click();
  await expect(page.locator("#authError")).toContainText("mindestens 10 Zeichen");
});

test("an account registered through the API is logged in right away", async ({ page, context }) => {
  await signUp(context);
  await page.goto("/");
  await expect(page).toHaveTitle("Español – Vokabeltrainer");
});
