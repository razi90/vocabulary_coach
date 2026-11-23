/* The course path: new words from the current unit, the explanation before
   the drill, the unit check, and the placement in the welcome. */
const { test, expect } = require("@playwright/test");
const { signUp, openApp, appReady, api, startWords } = require("./helpers");
const { course } = require("../../web/test/load");

/** The words of a course's first unit, from the same content the page loads. */
const firstUnitWords = (id) => { const c = course(id); return [...c.PATH.build(c.COURSE_PATH, c.DECK).units[0].words]; };

/** Answers the visible check or placement item correctly, from the course content the page has loaded. */
async function answerRight(page) {
  const prompt = await page.locator("#checkPrompt").textContent();
  const typed = await page.locator("#checkTypedWrap").isVisible();
  const answer = await page.evaluate(({ prompt, typed }) => {
    const g = GRAMMAR.ITEMS.find((it) => it.prompt === prompt);
    if (g) return g.answer;
    if (typed) return DECK.find((d) => d.de.split("|")[0] === prompt).term;
    return DECK.find((d) => d.term === prompt).de.split("|")[0];
  }, { prompt, typed });
  if (typed) {
    await page.locator("#checkInput").fill(answer);
    await page.locator("#checkCheckBtn").click();
  } else {
    await page.locator(`#checkGrid .mc-option[data-answer="${answer}"]`).click();
  }
  await expect(page.locator("#checkFeedback")).toHaveClass(/correct/);
  await page.locator("#checkContinueBtn").click();
}
async function answerAllRight(page) {
  while (!(await page.locator("#checkResult").isVisible())) await answerRight(page);
}

test("a beginner starts in the first unit and learns its words first @phone", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await expect(page.locator("#homeUnitTitle")).toHaveText("Sich vorstellen");
  await expect(page.locator("#homeUnitWhere")).toHaveText("A1 · Einheit 1 von 10");
  await expect(page.locator("#planList .plan-step")).toHaveCount(6);   // a lesson unit: dialogue … check
  await expect(page.locator("#planList .plan-step.later")).toContainText("Abschluss-Check");
  await startWords(page);
  // New words come from this unit only (in shuffled order).
  const front = await page.locator("#flipFront").textContent();
  expect(firstUnitWords("es")).toContain(front);
});

test("Kurs shows every level and opens a unit with its steps", async ({ page, context }) => {
  await signUp(context, { course: "en" });
  await openApp(page);
  await page.locator("#tab-course").click();
  await expect(page.locator("#courseRoute .route-code")).toHaveText(["A1", "A2", "B1"]);
  await expect(page.locator("#courseRoute .stop.current")).toHaveCount(1);
  await page.locator("#courseRoute .stop.current .stop-btn").click();
  await expect(page.locator("#unitTitle")).toHaveText("Sich vorstellen");
  await expect(page.locator("#unitSteps .unit-step")).toHaveCount(6);
  await expect(page.locator("#unitPrimary")).toHaveText("Dialog lesen");
});

test("the plan offers the explanation before the grammar drill", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await page.locator('#planList [data-kind="focus"]').click();
  await expect(page.locator("#guideTitle")).toHaveText("Ser oder estar");
  await expect(page.locator("#guideExamples li")).toHaveCount(5);
  await page.locator("#guidePractice").click();
  await expect(page.locator("#view-grammarsession")).toBeVisible();
  // Read once, the step now says how far the practice is.
  await page.locator("#exitGrammarBtn").click();
  await expect(page.locator("#view-home")).toBeVisible();
  await expect(page.locator('#planList [data-kind="focus"] .meta')).toHaveText("Üben · 0 von 8");
});

test("passing a unit's check completes it and moves on", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await page.locator("#homeUnit").click();
  await page.locator("#unitCheckAnyway").click();
  await answerAllRight(page);
  await expect(page.locator("#checkResultTitle")).toHaveText("Einheit geschafft");
  await expect(page.locator("#checkResultPrimary")).toHaveText("Weiter zu „Zählen und fragen“");
  await expect.poll(async () => (await api(context, "GET", "snapshot")).state.path?.units?.["a1-intro"]?.status).toBe("done");
  // Check answers are real answers in the log.
  const events = await api(context, "GET", "events");
  expect(events.some((e) => e.kind === "vocab" && e.mode === "check")).toBe(true);
  await page.locator("#tab-home").click();
  await expect(page.locator("#homeUnitTitle")).toHaveText("Zählen und fragen");
});

test("failing a check says how many were needed and keeps the unit open", async ({ page, context }) => {
  await signUp(context, { course: "en" });
  await openApp(page);
  await page.locator("#homeUnit").click();
  await page.locator("#unitCheckAnyway").click();
  while (!(await page.locator("#checkResult").isVisible())) {
    await page.locator("#checkSkipBtn").click();
    await page.locator("#checkContinueBtn").click();
  }
  await expect(page.locator("#checkResultTitle")).toHaveText("Noch nicht ganz");
  await expect(page.locator("#checkMissed .list-row").first()).toBeVisible();
  await page.locator("#checkResultPrimary").click();
  await expect(page.locator("#unitTitle")).toHaveText("Sich vorstellen");
});

test("placement: someone who knows A1 starts at A2, and nothing from the placement is logged @phone", async ({ page, context }) => {
  await signUp(context, { course: "es", welcome: true });
  await openApp(page);
  await page.locator("#welcomeNext").click();
  await page.locator('#welcomeLevels [data-start="placement"]').click();
  await page.locator("#welcomeNext").click();
  await page.locator("#welcomeNext").click();
  await expect(page.locator("#welcomeNext")).toHaveText("Zur Einstufung");
  await page.locator("#welcomeNext").click();
  await expect(page.locator("#view-check")).toBeVisible();
  await expect(page.locator("#tab-home")).toBeHidden();          // no navigation during the placement
  await answerAllRight(page);
  await expect(page.locator("#checkResultTitle")).toHaveText("A1 sitzt");
  await page.locator("#checkResultSecondary").click();          // start at A2 without testing it
  await expect(page.locator("#view-home")).toBeVisible();
  await expect(page.locator("#homeUnitWhere")).toHaveText("A2 · Einheit 1 von 12");
  await expect(page.locator("#homeUnitTitle")).toHaveText("Von gestern erzählen");
  expect(await api(context, "GET", "events")).toEqual([]);
  await page.reload();
  await appReady(page);
  await expect(page.locator("#homeUnitTitle")).toHaveText("Von gestern erzählen");
});

test("a learner from before the path keeps their place", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  const words = firstUnitWords("es");
  const now = Date.now();
  await api(context, "PATCH", "cards", Object.fromEntries(words.map((id) => [id, {
    id, state: "review", stability: 30, difficulty: 5, due: now + 5 * 86_400_000,
    lastReview: now - 86_400_000, reps: 3, lapses: 0, step: 0, interval: 5,
  }])));
  const { state } = await api(context, "GET", "snapshot");
  delete state.path;
  await api(context, "PUT", "state", state);
  await openApp(page);
  await expect(page.locator("#homeUnitTitle")).toHaveText("Zählen und fragen");
});
