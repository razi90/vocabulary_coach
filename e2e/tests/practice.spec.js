/* The other practice areas and the coach settings. Expected answers come
   from the course files themselves (loaded like web/test does), so the
   tests never carry a second copy of the content. */
const { test, expect } = require("@playwright/test");
const { course } = require("../../web/test/load");
const { api, signUp, openApp, openTab } = require("./helpers");

for (const id of ["es", "en"]) {
  test(`${id}: grammar - the right option is accepted and explained`, async ({ page, context }) => {
    const { GRAMMAR } = course(id);
    await signUp(context, { course: id });
    await openApp(page);
    await openTab(page, "grammar");
    await page.locator("#startGrammarBtn").click();

    for (let i = 0; i < 3; i++) {
      const prompt = await page.locator("#grammarPrompt").textContent();
      const shown = (await page.locator("#grammarGrid .mc-option").allTextContents()).sort();
      const item = GRAMMAR.ITEMS.find((it) => it.prompt === prompt && [...it.options].sort().join() === shown.join());
      expect(item, `no grammar item for "${prompt}"`).toBeTruthy();
      await page.locator("#grammarGrid .mc-option", { hasText: new RegExp(`^${escapeRe(item.answer)}$`) }).click();
      await expect(page.locator("#grammarGrid .mc-option.correct")).toHaveText(item.answer);
      await expect(page.locator("#grammarExplanation")).toHaveText(item.explanation);
      await expect(page.locator("#grammarScore")).toHaveText(`${i + 1} / ${i + 1} richtig`);
      await page.locator("#grammarContinueBtn").click();
    }
    await expect.poll(async () => (await api(context, "GET", "events"))
      .filter((e) => e.kind === "grammar").map((e) => e.ok)).toEqual([true, true, true]);
  });

  test(`${id}: conjugation - the right form is accepted, a wrong one corrected`, async ({ page, context }) => {
    const { CONJUGATE, COURSE } = course(id);
    await signUp(context, { course: id });
    await openApp(page);
    await openTab(page, "conj");
    await page.locator("#startConjBtn").click();

    const expectedForm = async () => {
      const tenseLabel = await page.locator("#conjTenseLabel").textContent();
      const tense = Object.keys(CONJUGATE.TENSE_LABELS).find((t) => CONJUGATE.TENSE_LABELS[t] === tenseLabel);
      const person = CONJUGATE.PERSON_LABELS.indexOf(await page.locator("#conjPersonLabel").textContent());
      const verb = CONJUGATE.findVerb(await page.locator("#conjInfinitive").textContent());
      return CONJUGATE.getForms(verb)[tense][person];
    };

    const right = await expectedForm();
    await page.locator("#conjInput").fill(right);
    await page.locator("#conjInput").press("Enter");
    await expect(page.locator("#conjFeedback")).toHaveText(COURSE.praise);
    await page.locator("#conjContinueBtn").click();

    const next = await expectedForm();
    await page.locator("#conjInput").fill("xyz");
    await page.locator("#conjCheckBtn").click();
    await expect(page.locator("#conjFeedback")).toHaveText(`Richtig wäre: ${next}`);
    await expect(page.locator("#conjScore")).toHaveText("1 / 2 richtig");
  });
}

test("en: a short form counts in the conjugation trainer", async ({ page, context }) => {
  const { CONJUGATE } = course("en");
  await signUp(context, { course: "en" });
  await openApp(page);
  await openTab(page, "conj");
  await page.locator("#startConjBtn").click();

  // Default tenses are Simple Past and Present Perfect; skip ahead to a Present Perfect item.
  for (let i = 0; i < 40; i++) {
    if ((await page.locator("#conjTenseLabel").textContent()) === "Present Perfect") break;
    await page.locator("#conjInput").fill("x");
    await page.locator("#conjCheckBtn").click();
    await page.locator("#conjContinueBtn").click();
  }
  await expect(page.locator("#conjTenseLabel")).toHaveText("Present Perfect");
  const verb = CONJUGATE.findVerb(await page.locator("#conjInfinitive").textContent());
  const person = CONJUGATE.PERSON_LABELS.indexOf(await page.locator("#conjPersonLabel").textContent());
  const short = CONJUGATE.alternatives(CONJUGATE.getForms(verb).present_perfect[person])[1];   // "'ve gone"
  await page.locator("#conjInput").fill(short);
  await page.locator("#conjCheckBtn").click();
  await expect(page.locator("#conjFeedback")).toHaveText("Correct!");
});

test("the word list finds a word with its meanings", async ({ page, context }) => {
  await signUp(context, { course: "en" });
  await openApp(page);
  await openTab(page, "browse");
  await page.locator("#browseSearch").fill("eventually");
  const row = page.locator("#browseList .bi-main", { hasText: "eventually" });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".bi-de")).toHaveText("schließlich, irgendwann");
});

test("Heute is only today's unit; without a lesson Üben lists none", async ({ page, context }) => {
  await signUp(context);
  await openApp(page);
  await expect(page.locator("#view-home .list-row")).toHaveCount(0);       // no list of extras
  await page.locator("#tab-practice").click();
  await expect(page.locator('#view-practice [data-open="lesson"]')).toHaveCount(0);
  await expect(page.locator("#practicePausedBlock")).toBeHidden();
});

test("coach settings: a key is required, and a stored key does not move to another provider", async ({ page, context }) => {
  // The model list comes from the provider over the internet; the test does not depend on it.
  await page.route("**/api/coach/models**", (r) => r.fulfill({ json: [{ id: "test/model", name: "Test Model" }] }));
  await signUp(context);
  await openApp(page);
  // Not set up yet: the coach offers to set it up instead of disabled buttons.
  await openTab(page, "coach");
  await page.locator("#coachSetup").click();
  await expect(page.locator("#view-settings")).toBeVisible();

  await page.locator("#coachProvider").selectOption("openrouter");
  await page.locator("#coachModelSelect").selectOption("test/model");   // a real dropdown of the provider's models
  await page.locator('#coachSettingsForm button[type="submit"]').click();
  await expect(page.locator("#coachSettingsError")).toHaveText("Bitte einen API-Schlüssel für OpenRouter eingeben.");
  expect((await api(context, "GET", "coach/settings")).hasKey).toBe(false);
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("coach settings: every model can be picked, and another ID typed in", async ({ page, context }) => {
  await page.route("**/api/coach/models**", (r) => r.fulfill({ json: [
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  ] }));
  await signUp(context);
  await openApp(page);
  await openTab(page, "settings");
  const select = page.locator("#coachModelSelect");
  await expect(select.locator("option")).toHaveCount(5);          // placeholder, three models, "other"
  await select.selectOption("anthropic/claude-haiku-5.5");
  await expect(page.locator("#coachModel")).toBeHidden();
  await expect(page.locator("#coachModel")).toHaveValue("anthropic/claude-haiku-5.5");
  await select.selectOption("__custom");
  await expect(page.locator("#coachModel")).toBeVisible();
  await page.locator("#coachModel").fill("qwen/qwen3.8-flash");
  await expect(page.locator("#coachModel")).toHaveValue("qwen/qwen3.8-flash");
});
