/* The coach's history: short by default, the whole report on request.
   Runs are stubbed - a real one needs a paid model. */
const { test, expect } = require("@playwright/test");
const { signUp, openApp, openTab } = require("./helpers");

const REPORT = `Die Tageslektion für den 19. November ist eingerichtet. Hier die Zusammenfassung:

**Thema: Menschen beschreiben & Alltag** – eine gemischte Wiederholung von *ser vs. estar* und *por vs. para*.

- **Writing:** Eine Personenbeschreibung mit *simpático* und *contento*.
- **Sentences:** Acht Übersetzungssätze.

Einen Hörteil gibt es heute nicht.`;

const run = (id, over = {}) => ({
  id, task: "lesson", status: "done", model: "deepseek-v4-pro", provider: "openrouter", note: "",
  started_at: new Date(Date.now() - id * 3600_000).toISOString(), prompt_tokens: 200000, completion_tokens: 15171,
  summary: REPORT, error: null,
  steps: Array.from({ length: 24 }, (_, i) => ({ kind: "tool", tool: "search_vocabulary", ok: true, text: `Schritt ${i}` })),
  ...over,
});

test("the history shows the latest runs briefly, with formatting, and opens on request @phone", async ({ page, context }) => {
  await page.route("**/api/coach/runs**", (r) => (r.request().method() === "GET"
    ? r.fulfill({ json: [1, 2, 3, 4, 5].map((id) => run(id)) }) : r.continue()));
  await page.route("**/api/coach/models**", (r) => r.fulfill({ json: [] }));
  await signUp(context);
  await openApp(page);
  await openTab(page, "coach");

  const runs = page.locator("#coachRuns .coach-run");
  await expect(runs).toHaveCount(3);
  const first = runs.first();
  await expect(first.locator(".coach-summary strong").first()).toHaveText("Thema: Menschen beschreiben & Alltag");
  await expect(first.locator(".coach-summary")).not.toContainText("**");
  await expect(first.locator(".coach-steps")).toBeHidden();
  const short = (await first.locator(".coach-summary").boundingBox()).height;

  await first.locator("[data-run-toggle]").click();
  await expect(first).toHaveClass(/open/);
  expect((await first.locator(".coach-summary").boundingBox()).height).toBeGreaterThan(short);
  await expect(first.locator(".coach-run-more > details > summary")).toContainText("24 Schritte");
  await expect(first.locator("[data-run-toggle]")).toHaveText("Weniger anzeigen");

  await page.locator("[data-runs-all]").click();
  await expect(runs).toHaveCount(5);
});
