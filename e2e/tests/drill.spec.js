const { test, expect } = require("@playwright/test");
const { api, signUp, seedTypingDrill, openApp } = require("./helpers");

test("a new learner learns the first flashcard and it is recorded @phone", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await page.locator("#startSessionBtn").click();

  await expect(page.locator("#mode-flip")).toBeVisible();
  const front = await page.locator("#flipFront").textContent();
  expect(front.trim()).not.toBe("");
  await page.locator("#flashcard").click();
  await expect(page.locator("#flipBack")).not.toBeEmpty();

  const logged = page.waitForResponse((r) => r.url().endsWith("/api/events") && r.request().method() === "POST");
  await page.locator('.grade-btn[data-grade="3"]').click();
  expect((await logged).ok()).toBeTruthy();
  await expect(page.locator("#sessionIdx")).toHaveText("2");

  const events = await api(context, "GET", "events");
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: "vocab", id: front.trim() });
});

test("typing the German meaning without its bracketed note counts as right", async ({ page, context }) => {
  await signUp(context, { course: "en" });
  await seedTypingDrill(context, ["ago"]);              // de: "vor (zeitlich)"
  await openApp(page);
  await page.locator("#startSessionBtn").click();

  await expect(page.locator("#mode-type")).toBeVisible();
  await expect(page.locator("#typePrompt")).toHaveText("ago");
  await page.locator("#typeInput").fill("vor");
  await page.locator("#typeCheckBtn").click();
  await expect(page.locator("#typeFeedback")).toHaveText("Richtig!");
});

test("a curly apostrophe from a phone keyboard counts as right @phone", async ({ page, context }) => {
  await signUp(context, { course: "en" });
  await seedTypingDrill(context, ["I'm afraid"], { direction: "de-es" });   // German prompt, English answer
  await openApp(page);
  await page.locator("#startSessionBtn").click();

  await expect(page.locator("#typePrompt")).toHaveText("leider");
  await page.locator("#typeInput").fill("I’m afraid");
  await page.locator("#typeCheckBtn").click();
  await expect(page.locator("#typeFeedback")).toHaveText("Richtig!");
});

test("a typo is almost right and shows the spelling, a wrong word is wrong", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await seedTypingDrill(context, ["la casa", "el perro"]);
  await openApp(page);
  await page.locator("#startSessionBtn").click();

  for (let i = 0; i < 2; i++) {
    const prompt = (await page.locator("#typePrompt").textContent()).trim();
    if (prompt === "la casa") {
      await page.locator("#typeInput").fill("das Hasu");
      await page.locator("#typeCheckBtn").click();
      await expect(page.locator("#typeFeedback")).toContainText("Fast");
    } else {
      expect(prompt).toBe("el perro");
      await page.locator("#typeInput").fill("die Katze");
      await page.locator("#typeCheckBtn").click();
      await expect(page.locator("#typeFeedback")).toContainText("Richtig wäre: der Hund");
    }
    await page.locator("#sessionContinueBtn").click();
  }
  // The wrong one comes back once as a flashcard; the almost-right one does not.
  await expect(page.locator("#mode-flip")).toBeVisible();
  await expect(page.locator("#flipFront")).toHaveText("el perro");
  await page.locator("#flashcard").click();
  await page.locator('.grade-btn[data-grade="3"]').click();

  await expect(page.locator("#view-done")).toBeVisible();
  await expect(page.locator("#doneReviewed")).toHaveText("3");

  // Answers are logged in the background; wait for all three.
  await expect.poll(async () => (await api(context, "GET", "events")).length).toBe(3);
  const typed = (await api(context, "GET", "events"))
    .filter((e) => e.mode === "type").map((e) => [e.id, e.ok, e.typed]).sort();
  expect(typed).toEqual([["el perro", false, "die Katze"], ["la casa", true, "das Hasu"]]);
});
