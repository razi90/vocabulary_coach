/* A unit as a lesson (pilot units only): dialogue, sentences, own words. */
const { test, expect } = require("@playwright/test");
const { signUp, openApp, appReady, api } = require("./helpers");

test("the first unit starts with its dialogue, and its questions are answered there @phone", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await expect(page.locator('#planList [data-plan="0"] .title')).toHaveText("Dialog: Auf einer Party");
  await expect(page.locator("#startSessionBtn")).toHaveText("Dialog lesen");
  await page.locator("#startSessionBtn").click();
  await expect(page.locator("#dialogLines .dialog-line")).toHaveCount(10);
  await expect(page.locator("#dialogLines .dialog-de").first()).toBeHidden();
  await page.locator("#dialogTranslate").click();
  await expect(page.locator("#dialogLines .dialog-de").first()).toHaveText("Hallo! Ich heiße Lucía. Und du?");
  await page.locator("#dialogQuestions").click();
  const answers = await page.evaluate(() => COURSE_PATH.UNITS[0].lesson.dialogue.questions.map((q) => [q.prompt, q.answer]));
  for (let i = 0; i < answers.length; i++) {
    const prompt = await page.locator("#checkPrompt").textContent();
    const answer = answers.find(([p]) => p === prompt)[1];
    await page.locator(`#checkGrid .mc-option[data-answer="${answer}"]`).click();
    await page.locator("#checkContinueBtn").click();
  }
  await expect(page.locator("#checkResultTitle")).toHaveText("Dialog verstanden");
  await expect(page.locator("#checkResultPrimary")).toHaveText("Weiter: Neue Wörter lernen");
  await expect.poll(async () => (await api(context, "GET", "snapshot")).state.path?.lessons?.["a1-intro"]?.dialog?.right).toBe(4);
});

test("building sentences logs each answer as a sentence", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await page.locator("#homeUnit").click();
  await page.locator('#unitSteps [data-step="sentences"]').click();
  await expect(page.locator("#checkAsk")).toHaveText("Wie sagt man das auf Spanisch?");
  const sentences = await page.evaluate(() => COURSE_PATH.UNITS[0].lesson.sentences.map((x) => [x.de, x.t]));
  for (let i = 0; i < sentences.length; i++) {
    const prompt = await page.locator("#checkPrompt").textContent();
    await page.locator("#checkInput").fill(sentences.find(([de]) => de === prompt)[1]);
    await page.locator("#checkCheckBtn").click();
    await expect(page.locator("#checkFeedback")).toHaveClass(/correct/);
    await page.locator("#checkContinueBtn").click();
  }
  await expect(page.locator("#checkResultTitle")).toHaveText("Sätze gebaut");
  await expect.poll(async () => (await api(context, "GET", "events")).filter((e) => e.kind === "sentence" && e.ok).length).toBe(7);
});

test("the own-words task shows a model answer once it is done", async ({ page, context }) => {
  await signUp(context, { course: "en" });
  await openApp(page);
  await page.locator("#homeUnit").click();
  await page.locator('#unitSteps [data-step="task"]').click();
  await expect(page.locator("#taskTitle")).toHaveText("Stell dich vor");
  await expect(page.locator("#taskSubmit")).toBeDisabled();
  await page.locator("#taskText").fill("Hi, my name is Eva. I'm from Bremen and I'm a teacher.");
  await page.locator("#taskSubmit").click();
  await expect(page.locator("#taskModel")).toContainText("my name is Anna");
  await expect.poll(async () => (await api(context, "GET", "snapshot")).state.path?.lessons?.["a1-intro"]?.task?.text).toContain("Eva");
  await page.locator("#taskBack").click();
  await expect(page.locator('#unitSteps .unit-step.done .step-title', { hasText: "Sprechen" })).toHaveCount(1);
});

test("every unit of both courses is a full lesson", async ({ page, context }) => {
  await signUp(context, { course: "en" });
  await openApp(page);
  await page.locator("#tab-course").click();
  await page.locator('#courseRoute [data-unit="b1-life"]').click();
  await expect(page.locator("#unitSteps .unit-step")).toHaveCount(6);
  for (const id of ["es", "en"]) {
    const { COURSE_PATH } = require("../../web/test/load").course(id);
    expect(COURSE_PATH.UNITS.filter((u) => !u.lesson).map((u) => u.id)).toEqual([]);
  }
});

test("a reload keeps the open dialogue, explanation and unit", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await page.locator("#homeUnit").click();
  await page.locator('#unitSteps [data-step="dialog"]').click();
  await page.reload();
  await appReady(page);
  await expect(page.locator("#view-dialog")).toBeVisible();
  await expect(page.locator("#dialogTitle")).toHaveText("Auf einer Party");

  await page.locator("#view-dialog .back-link").click();
  await page.locator("#unitSteps [data-guide]").click();
  await page.reload();
  await appReady(page);
  await expect(page.locator("#guideTitle")).toHaveText("Ser oder estar");
  await page.locator("#guideBack").click();
  await expect(page.locator("#unitTitle")).toHaveText("Sich vorstellen");

  await page.reload();
  await appReady(page);
  await expect(page.locator("#view-unit")).toBeVisible();
  await expect(page.locator("#unitTitle")).toHaveText("Sich vorstellen");
});
