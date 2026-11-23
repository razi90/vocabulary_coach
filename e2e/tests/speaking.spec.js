/* The lesson's speaking part when the browser's speech recognition misbehaves.
   The recognition engine is faked; the lesson comes from a stubbed /api/lesson
   (lessons are written by the coach, not through the learner's API). */
const { test, expect } = require("@playwright/test");
const { signUp, openApp } = require("./helpers");

const LESSON = {
  id: 999, day: new Date().toISOString().slice(0, 10), title: "Im Restaurant", theme: "Essen", level: "A2",
  speaking: { topic: "Erzähl von deinem Lieblingsessen.", prompts: ["Was isst du gern?"], usefulPhrases: ["Me gusta…"], minSeconds: 60 },
  submissions: {},
};

/** A recognition engine that behaves as given: "network" error, or ending after a pause. */
async function fakeRecognition(page, behaviour) {
  await page.addInitScript((behaviour) => {
    window.__recognition = { created: 0, starts: 0 };
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      constructor() { window.__recognition.created += 1; }
      start() {
        window.__recognition.starts += 1;
        if (behaviour === "network") {
          setTimeout(() => { this.onerror && this.onerror({ error: "network" }); this.onend && this.onend(); }, 50);
        } else if (behaviour === "pauses") {
          // Says one sentence, then ends by itself as Chrome does after a pause.
          setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "me gusta la paella" }], { isFinal: true })] }), 50);
          setTimeout(() => this.onend && this.onend(), 300);
        }
      }
      stop() {} abort() {}
    };
  }, behaviour);
}

async function openSpeaking(page, context) {
  await page.route("**/api/lesson", (r) => (r.request().method() === "GET" ? r.fulfill({ json: LESSON }) : r.continue()));
  await signUp(context, { course: "es" });
  await openApp(page);
  await page.locator("#tab-practice").click();
  await page.locator('#view-practice [data-open="lesson"]').click();
  await expect(page.locator("#partSpeaking")).toBeVisible();
}

test("recognition out of reach: an honest message, and the timer keeps running", async ({ page, context }) => {
  await fakeRecognition(page, "network");
  await openSpeaking(page, context);
  await page.locator("#speakStart").click();
  await expect(page.locator("#speakHint")).toContainText("nicht erreichbar");
  await expect(page.locator("#speakHint")).not.toContainText("Internetverbindung");
  await expect(page.locator("#speakStart")).toHaveText("Aufnahme stoppen");
  await expect(page.locator("#speakTimer")).toHaveText(/^0:0[2-9] \/ 1:00$/, { timeout: 5000 });

  await page.locator("#speakStart").click();                 // stop
  await expect(page.locator("#speakStart")).toHaveText("Aufnahme starten");
  await page.locator("#speakStart").click();                 // again: no new try at the broken service
  await expect(page.locator("#speakStart")).toHaveText("Aufnahme stoppen");
  expect(await page.evaluate(() => window.__recognition.created)).toBe(1);

  // Typing what was said is enough to hand it in.
  await page.locator("#speakingText").fill("Me gusta mucho la paella con mariscos.");
  await expect(page.locator("#speakingSubmit")).toBeEnabled();
});

test("recognition ending after a pause is started again until the learner stops", async ({ page, context }) => {
  await fakeRecognition(page, "pauses");
  await openSpeaking(page, context);
  await page.locator("#speakStart").click();
  await expect.poll(() => page.evaluate(() => window.__recognition.starts)).toBeGreaterThanOrEqual(3);
  await expect(page.locator("#speakStart")).toHaveText("Aufnahme stoppen");
  await expect(page.locator("#speakingText")).toHaveValue(/me gusta la paella/);
  await page.locator("#speakStart").click();
  const starts = await page.evaluate(() => window.__recognition.starts);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__recognition.starts)).toBe(starts);   // stopped means stopped
});

test("in Brave the speaking part says so up front and runs the timer only", async ({ page, context }) => {
  await fakeRecognition(page, "network");
  await page.addInitScript(() => { Object.defineProperty(navigator, "brave", { value: { isBrave: () => Promise.resolve(true) } }); });
  await openSpeaking(page, context);
  await expect(page.locator("#speakHint")).toContainText("In Brave gibt es keine Spracherkennung");
  await page.locator("#speakStart").click();
  await expect(page.locator("#speakTimer")).toHaveText(/^0:0[1-9] \/ 1:00$/, { timeout: 4000 });
  expect(await page.evaluate(() => window.__recognition.created)).toBe(0);   // no doomed attempt
});
