/* The four features from the redesign: welcome, word detail, pronunciation,
   practice calendar - plus the settings that moved. */
const { test, expect } = require("@playwright/test");
const { api, signUp, openApp, openTab, seedTypingDrill } = require("./helpers");

const vocab = (id, ok, typed, expected, dir = "es-de") =>
  ({ t: Date.now(), kind: "vocab", id, dir, mode: "type", grade: ok ? 3 : 1, ok, typed, expected });

/** A speech engine with one voice per given language that records what it says. */
async function fakeSpeech(page, langs) {
  await page.addInitScript((langs) => {
    window.__said = [];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => langs.map((lang) => ({ lang, name: `voice ${lang}` })),
      speak: (u) => window.__said.push([u.text, u.lang]),
      cancel: () => {}, addEventListener: () => {},
    } });
  }, langs);
}

test.describe("welcome", () => {
  test("a new learner keeps the language, picks a daily goal, and is welcomed once @phone", async ({ page, context }) => {
    await signUp(context, { course: "en", welcome: true });
    await openApp(page);
    await expect(page.locator("#view-welcome")).toBeVisible();
    await expect(page.locator("#tab-home")).toBeHidden();            // no navigation during the welcome
    // Step 1: the language, the current course chosen.
    await expect(page.locator('#welcomeCourses .choice[data-course="en"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#welcomeCourses .choice")).toHaveText(["Spanisch", "Englisch"]);
    await page.locator("#welcomeNext").click();

    await expect(page.locator('.welcome-step[data-step="2"] h1')).toHaveText("Jeden Tag ein bisschen Englisch.");
    await page.locator("#welcomeNext").click();
    await page.locator('#welcomeGoals .choice[data-goal="40"]').click();
    await expect(page.locator('#welcomeGoals .choice[data-goal="40"]')).toHaveAttribute("aria-checked", "true");
    await page.locator("#welcomeNext").click();
    await expect(page.locator('.welcome-step[data-step="4"]')).toBeVisible();
    await page.locator("#welcomeNext").click();

    await expect(page.locator("#view-home")).toBeVisible();
    await expect(page.locator("#dailyGoalNum")).toHaveText("40");
    await expect.poll(async () => (await api(context, "GET", "snapshot")).state.welcomeSeen).toBe(true);
    await openApp(page);
    await expect(page.locator("#view-home")).toBeVisible();
  });

  test("choosing the other language switches the course and the welcome carries on there", async ({ page, context }) => {
    await signUp(context, { course: "es", welcome: true });
    await openApp(page);
    await page.locator('#welcomeCourses .choice[data-course="en"]').click();
    await page.locator("#welcomeNext").click();
    await expect(page).toHaveTitle("English – Vokabeltrainer");
    await expect(page.locator('.welcome-step[data-step="2"]')).toBeVisible();   // not back to step 1
    expect((await api(context, "GET", "auth/me")).course).toBe("en");
    await page.locator("#welcomeSkip").click();
    await expect(page.locator("#view-home")).toBeVisible();
    await expect(page.locator(".brand-name")).toHaveText("English");
  });

  test("a learner with answers in the course never sees it", async ({ page, context }) => {
    await signUp(context, { welcome: true });
    await api(context, "POST", "events", vocab("la casa", true, "das Haus", "das Haus"));
    await openApp(page);
    await expect(page.locator("#view-home")).toBeVisible();
    await expect(page.locator("#view-welcome")).toBeHidden();
  });
});

test("the word sheet shows a word's record and the actual mix-ups @phone", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await api(context, "POST", "events", vocab("la puerta", true, "die Tür", "die Tür"));
  await api(context, "POST", "events", vocab("la puerta", false, "die Verspätung", "die Tür"));
  await openApp(page);
  await openTab(page, "browse");
  await page.locator("#browseSearch").fill("puerta");
  await page.locator('[data-word="la puerta"]').click();

  const sheet = page.locator("#wordSheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".sheet-term")).toHaveText("la puerta");
  await expect(sheet.locator("dl.kv")).toContainText("1 von 2");
  await expect(sheet.locator(".slips")).toContainText("verwechselt mit el retraso (die Verspätung)");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.locator('[data-word="la puerta"]')).toBeFocused();   // focus goes back to the row
});

test.describe("pronunciation", () => {
  test("without a voice for the course language there are no speaker buttons", async ({ page, context }) => {
    await fakeSpeech(page, ["de-DE"]);
    await signUp(context, { course: "es" });
    await openApp(page);
    await openTab(page, "browse");
    await expect(page.locator("#browseList [data-say]").first()).toBeHidden();
  });

  test("a speaker reads the course word and does not open the row", async ({ page, context }) => {
    await fakeSpeech(page, ["en-GB"]);
    await signUp(context, { course: "en" });
    await openApp(page);
    await openTab(page, "browse");
    await page.locator("#browseSearch").fill("eventually");
    await page.locator('#browseList [data-say="eventually"]').click();
    expect(await page.evaluate(() => window.__said)).toEqual([["eventually", "en-GB"]]);
    await expect(page.locator("#wordSheet")).toBeHidden();
  });

  test("German to course language: the card speaker only appears after turning", async ({ page, context }) => {
    await fakeSpeech(page, ["es-ES"]);
    await signUp(context, { course: "es" });
    await api(context, "PUT", "state", { ...(await api(context, "GET", "snapshot")).state, direction: "de-es" });
    await openApp(page);
    await page.locator("#startSessionBtn").click();
    await expect(page.locator("#mode-flip")).toBeVisible();
    await expect(page.locator("#cardSpeak")).toBeHidden();
    await page.locator("#flashcard").click();
    await expect(page.locator("#cardSpeak")).toBeVisible();
    await page.locator("#cardSpeak").click();
    const said = await page.evaluate(() => window.__said);
    expect(said).toHaveLength(1);
    expect(said[0][1]).toBe("es-ES");
    await expect(page.locator("#flashcard")).toHaveClass(/flipped/);      // the click did not turn the card back
  });
});

test("Fortschritt: today in the calendar, the week and the hardest words", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  for (let i = 0; i < 2; i++) await api(context, "POST", "events", vocab("la casa", false, "die Katze", "das Haus"));
  await api(context, "POST", "events", vocab("la puerta", true, "die Tür", "die Tür"));
  await openApp(page);
  await openTab(page, "stats");

  const today = page.locator(".cal-day.today");
  await expect(today).toHaveClass(/l1/);
  await expect(today).toHaveAttribute("aria-label", /3 Antworten/);
  await expect(page.locator("#calNext")).toBeDisabled();
  await expect(page.locator("#weekSummary")).toContainText("3Antworten diese Woche");
  await expect(page.locator("#weekSummary")).toContainText("33 %");

  await page.locator("#calPrev").click();
  await expect(page.locator(".cal-day.today")).toHaveCount(0);
  await expect(page.locator("#calNext")).toBeEnabled();

  const hardest = page.locator("#hardestList .list-row").first();
  await expect(hardest).toContainText("la casa");
  await expect(hardest).toContainText("2× falsch");
  await hardest.click();
  await expect(page.locator("#wordSheet .sheet-term")).toHaveText("la casa");
});

test("settings: the daily goal is saved and shown on Heute", async ({ page, context }) => {
  await signUp(context);
  await openApp(page);
  await openTab(page, "settings");
  await page.locator("#dailyGoal").fill("35");
  await openTab(page, "home");
  await expect(page.locator("#dailyGoalNum")).toHaveText("35");
  await expect.poll(async () => (await api(context, "GET", "snapshot")).state.dailyGoal).toBe(35);
});

test("the session end lists the missed word and opens it", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await seedTypingDrill(context, ["el perro"]);
  await openApp(page);
  await page.locator("#startSessionBtn").click();
  await page.locator("#typeInput").fill("die Katze");
  await page.locator("#typeCheckBtn").click();
  await page.locator("#sessionContinueBtn").click();
  await page.locator("#flashcard").click();                 // the missed word comes back once
  await page.locator('.grade-btn[data-grade="3"]').click();

  await expect(page.locator("#view-done")).toBeVisible();
  await page.locator('#doneMissed [data-word="el perro"]').click();
  await expect(page.locator("#wordSheet .sheet-term")).toHaveText("el perro");
});
