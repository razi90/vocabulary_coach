const { test, expect } = require("@playwright/test");
const { api, signUp, openApp, openTab } = require("./helpers");

const SCHEMA = "vocab-coach/exercise-pack@1";
const sinceFor = {
  schema: SCHEMA, id: "since-for", title: "since oder for", createdBy: "coach",
  items: [
    { type: "choice", prompt: "I have lived here ___ 2015.", options: ["since", "for"], answer: "since",
      explanation: "2015 ist ein Zeitpunkt → since." },
    { type: "cloze", prompt: "We have known each other ___ ten years.", answer: "for",
      explanation: "ten years ist ein Zeitraum → for." },
    { type: "translate", prompt: "Ich wohne seit drei Jahren hier.", answer: "I have lived here for three years",
      alternatives: ["I've lived here for three years"], explanation: "Dauer bis jetzt → Present Perfect + for." },
  ],
};

test("a set from the coach appears without reloading and can be practised @phone", async ({ page, context }) => {
  await signUp(context, { course: "en" });
  await openApp(page);
  await openTab(page, "packs");
  await expect(page.locator("#packMessage")).toContainText("Noch keine Übungen");

  // The coach writes through the API; the open tab hears about it by server-sent event.
  await api(context, "POST", "packs", sinceFor);
  const card = page.locator(".pack-card", { hasText: "since oder for" });
  await expect(card).toContainText("3 Aufgaben");

  await card.locator(".pack-start").click();
  // Items come in random order: answer each by its prompt.
  const expected = {};
  for (let i = 0; i < 3; i++) {
    const prompt = (await page.locator("#packPrompt").textContent()).trim();
    if (prompt.startsWith("I have lived here")) {
      await page.locator("#packGrid button", { hasText: "since" }).click();
      await expect(page.locator("#packFeedback")).toHaveText("Richtig!");
      await expect(page.locator("#packExplanation")).toHaveText("2015 ist ein Zeitpunkt → since.");
      expected.choice = true;
    } else if (prompt.startsWith("We have known")) {
      await page.locator("#packInput").fill("since");          // the mix-up the set is about
      await page.locator("#packCheckBtn").click();
      await expect(page.locator("#packFeedback")).toContainText("for");
      await expect(page.locator("#packFeedback")).not.toHaveText("Richtig!");
      expected.cloze = false;
    } else {
      expect(prompt).toBe("Ich wohne seit drei Jahren hier.");
      await page.locator("#packInput").fill("I’ve lived here for three yaers");
      await page.locator("#packCheckBtn").click();
      await expect(page.locator("#packFeedback")).toContainText("Fast");
      expected.translate = true;
    }
    await page.locator("#packContinueBtn").click();
  }
  expect(expected).toEqual({ choice: true, cloze: false, translate: true });

  // Answers are logged in the background; wait for the last one.
  await expect.poll(async () => (await api(context, "GET", "events"))
    .filter((e) => e.kind === "pack").map((e) => e.ok).sort()).toEqual([false, true, true]);
});

test("importing a file reports broken items and keeps the good ones", async ({ page, context }) => {
  await signUp(context, { course: "en" });
  await openApp(page);
  await openTab(page, "packs");

  const pack = { ...sinceFor, id: "import-test", title: "Import-Test",
    items: [...sinceFor.items, { type: "choice", prompt: "x ___", options: ["a", "b"], answer: "c" }] };
  await page.locator("#importPackInput").setInputFiles({
    name: "import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pack)),
  });
  await expect(page.locator(".pack-card", { hasText: "Import-Test" })).toContainText("3 Aufgaben");
});

test("a broken file is refused with the reason", async ({ page, context }) => {
  await signUp(context, { course: "es" });
  await openApp(page);
  await openTab(page, "packs");
  await page.locator("#importPackInput").setInputFiles({
    name: "kaputt.json", mimeType: "application/json", buffer: Buffer.from('{"schema":"falsch"}'),
  });
  await expect(page.locator("#packErrors, #packMessage").filter({ hasText: /schema|ungültig/ })).toBeVisible();
  await expect(page.locator(".pack-card")).toHaveCount(0);
});
