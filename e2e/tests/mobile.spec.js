/* Phone layout: what makes the app usable on a small touch screen. */
const { test, expect } = require("@playwright/test");
const { signUp, openApp, openTab } = require("./helpers");

test.beforeEach(({ isMobile }) => test.skip(!isMobile, "phone layout only"));

/** Form fields under 16px make iOS zoom the page on focus. */
const smallFields = (page) => page.evaluate(() =>
  [...document.querySelectorAll("input:not([type=range]):not([type=file]):not([type=hidden]), select, textarea")]
    .filter((e) => e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).fontSize) < 16)
    .map((e) => e.id || e.name || e.className));

test("the menu opens and closes with its own button @phone", async ({ page, context }) => {
  await signUp(context);
  await openApp(page);
  const menu = page.locator("#menuBtn");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await menu.click();                                   // the button stays on top of the drawer
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  const box = await menu.boundingBox();
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
});

test("no screen scrolls sideways and no field makes iOS zoom @phone", async ({ page, context }) => {
  await page.route("**/api/coach/models**", (r) => r.fulfill({ json: [] }));
  await page.goto("/login.html#registrieren");
  expect(await smallFields(page)).toEqual([]);

  await signUp(context, { course: "en" });
  await openApp(page);
  for (const tab of ["home", "lesson", "coach", "browse", "conj", "grammar", "packs", "stats"]) {
    await openTab(page, tab);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${tab} scrolls sideways`).toBeLessThanOrEqual(0);
    expect(await smallFields(page), `${tab}: fields under 16px`).toEqual([]);
  }
});

test("answer fields switch off autocorrect, which would fix the learner's mistakes @phone", async ({ page, context }) => {
  await signUp(context);
  await openApp(page);
  for (const id of ["typeInput", "conjInput", "packInput"]) {
    await expect(page.locator(`#${id}`)).toHaveAttribute("autocorrect", "off");
    await expect(page.locator(`#${id}`)).toHaveAttribute("autocapitalize", "off");
  }
});
