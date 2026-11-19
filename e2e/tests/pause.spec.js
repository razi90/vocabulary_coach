/* Leaving a drill pauses it; the trainer then offers to continue. */
const { test, expect } = require("@playwright/test");
const { api, signUp, openApp, openTab } = require("./helpers");

/** Turns and grades the current flashcard. */
async function learnCard(page) {
  await page.locator("#flashcard").click();
  await page.locator('.grade-btn[data-grade="3"]').click();
}

test("vocabulary: pause with ✕, survive a reload, continue where it was @phone", async ({ page, context }) => {
  page.on("dialog", () => { throw new Error("leaving a drill must not ask"); });
  await signUp(context, { course: "es" });
  await openApp(page);
  await page.locator("#startSessionBtn").click();
  const total = await page.locator("#sessionTotal").textContent();
  await learnCard(page);
  await learnCard(page);
  await expect(page.locator("#sessionIdx")).toHaveText("3");
  const third = await page.locator("#flipFront").textContent();

  await page.locator("#exitSessionBtn").click();
  await expect(page.locator("#startSessionBtn")).toHaveText(`Fortsetzen · 2 von ${total}`);
  await expect(page.locator("#restartSessionBtn")).toBeVisible();

  await openApp(page);                                      // a reload, or the app closed and opened again
  await expect(page.locator("#startSessionBtn")).toHaveText(`Fortsetzen · 2 von ${total}`);
  await openTab(page, "practice");
  await expect(page.locator("#practiceVocabMeta")).toHaveText(`Pausiert · 2 von ${total}`);
  await openTab(page, "home");
  await page.locator("#startSessionBtn").click();
  await expect(page.locator("#sessionIdx")).toHaveText("3");
  await expect(page.locator("#flipFront")).toHaveText(third);
});

test("vocabulary: a new session on request", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await page.locator("#startSessionBtn").click();
  await learnCard(page);
  await page.locator("#exitSessionBtn").click();
  await page.locator("#restartSessionBtn").click();
  await expect(page.locator("#view-session")).toBeVisible();
  await expect(page.locator("#sessionIdx")).toHaveText("1");
});

test("grammar: switching sections keeps the drill; continue or start over", async ({ page, context }) => {
  page.on("dialog", () => { throw new Error("leaving a drill must not ask"); });
  await signUp(context, { course: "en" });
  await openApp(page);
  await openTab(page, "grammar");
  await page.locator("#startGrammarBtn").click();
  await page.locator("#grammarGrid .mc-option").first().click();
  await page.locator("#grammarContinueBtn").click();
  await expect(page.locator("#grammarIdx")).toHaveText("2");
  // A wrong answer comes back later, so the total is read after answering.
  const total = await page.locator("#grammarTotal").textContent();

  await page.locator("#tab-stats").click();                 // just leave
  await expect(page.locator("#view-stats")).toBeVisible();
  await openTab(page, "home");
  await expect(page.locator('[data-today="resume"][data-id="grammar"]')).toContainText(`1 von ${total}`);

  await openTab(page, "grammar");
  await expect(page.locator("#startGrammarBtn")).toHaveText(`Fortsetzen · 1 von ${total}`);
  await page.locator("#startGrammarBtn").click();
  await expect(page.locator("#grammarIdx")).toHaveText("2");
  await expect(page.locator("#grammarScore")).toContainText("/ 1 richtig");

  await page.locator("#exitGrammarBtn").click();
  await page.locator("#restartGrammarBtn").click();
  await expect(page.locator("#grammarIdx")).toHaveText("1");
  await expect(page.locator("#grammarScore")).toHaveText("0 / 0 richtig");
});

test("an exercise set paused halfway is offered on Heute and in the list", async ({ page, context }) => {
  await signUp(context, { course: "en" });
  await api(context, "POST", "packs", {
    schema: "vocab-coach/exercise-pack@1", id: "since-for", title: "since oder for",
    items: [1, 2, 3].map((n) => ({ type: "choice", prompt: `Frage ${n} ___`, options: ["since", "for"], answer: "since" })),
  });
  await openApp(page);
  await openTab(page, "packs");
  await page.locator(".pack-start").click();
  await page.locator("#packGrid button").first().click();
  await page.locator("#packContinueBtn").click();
  await page.locator("#exitPackBtn").click();

  await expect(page.locator(".pack-start")).toHaveText(/^Fortsetzen · 1 von \d+$/);
  await openTab(page, "home");
  const row = page.locator('[data-today="resume"][data-id="pack"]');
  await expect(row).toContainText("since oder for fortsetzen");
  await row.click();
  await expect(page.locator("#packIdx")).toHaveText("2");
});

test("yesterday's paused session is not offered any more", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await page.locator("#startSessionBtn").click();
  await learnCard(page);
  await page.evaluate(() => {
    const key = "voco:paused:es";
    const saved = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...saved, day: "2000-01-01" }));
  });
  await openApp(page);
  await expect(page.locator("#startSessionBtn")).toHaveText(/Sitzung starten|Weiterlernen/);
  await expect(page.locator("#restartSessionBtn")).toBeHidden();
});
