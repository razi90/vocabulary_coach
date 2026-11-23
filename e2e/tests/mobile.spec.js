/* Phone layout: what makes the app usable on a small touch screen. */
const { test, expect } = require("@playwright/test");
const { signUp, openApp, openTab } = require("./helpers");

test.beforeEach(({ isMobile }) => test.skip(!isMobile, "phone layout only"));

/** Form fields under 16px make iOS zoom the page on focus. */
const smallFields = (page) => page.evaluate(() =>
  [...document.querySelectorAll("input:not([type=range]):not([type=file]):not([type=hidden]), select, textarea")]
    .filter((e) => e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).fontSize) < 16)
    .map((e) => e.id || e.name || e.className));

test("the five sections sit in a tab bar at the bottom @phone", async ({ page, context }) => {
  await signUp(context);
  await openApp(page);
  const vh = page.viewportSize().height;
  for (const id of ["home", "course", "practice", "coach", "stats"]) {
    const box = await page.locator(`#tab-${id}`).boundingBox();
    expect(box.y + box.height, `${id} at the bottom`).toBeGreaterThan(vh - 90);
    expect(Math.min(box.width, box.height), `${id} big enough to tap`).toBeGreaterThanOrEqual(44);
    await page.locator(`#tab-${id}`).click();
    await expect(page.locator(`#tab-${id}`)).toHaveAttribute("aria-current", "page");
  }
});

test("no screen scrolls sideways and no field makes iOS zoom @phone", async ({ page, context }) => {
  await page.route("**/api/coach/models**", (r) => r.fulfill({ json: [] }));
  await page.goto("/login.html#registrieren");
  expect(await smallFields(page)).toEqual([]);

  await signUp(context, { course: "en" });
  await openApp(page);
  for (const tab of ["home", "course", "practice", "coach", "stats", "settings", "browse", "conj", "grammar", "packs"]) {
    await openTab(page, tab);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${tab} scrolls sideways`).toBeLessThanOrEqual(0);
    expect(await smallFields(page), `${tab}: fields under 16px`).toEqual([]);
  }
});

test("answer fields switch off autocorrect, which would fix the learner's mistakes @phone", async ({ page, context }) => {
  await signUp(context);
  await openApp(page);
  for (const id of ["typeInput", "conjInput", "packInput", "checkInput"]) {
    await expect(page.locator(`#${id}`)).toHaveAttribute("autocorrect", "off");
    await expect(page.locator(`#${id}`)).toHaveAttribute("autocapitalize", "off");
  }
});
