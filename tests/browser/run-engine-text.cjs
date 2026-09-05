// Uses the same installed Playwright/Chrome setup as run-engine-windows.cjs.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname, "engine-smoke.html")).href);
    await page.waitForFunction(() => window.emberlySmoke?.ok);
    await page.waitForTimeout(4000);
    const glyphs = () => page.evaluate(() => {
      const atlas = window.textEngine?.tree.textAtlas || window.emberlyHarness.tree.textAtlas;
      return Object.fromEntries(Object.entries(atlas.fontFamilyCache).map(([font, chars]) => [font,
        Object.fromEntries(Object.entries(chars).map(([char, obj]) => [char, { x: obj.rectX, y: obj.rectY, width: obj.width }]))]));
    });
    const originalGlyphs = await glyphs();
    const view = await page.evaluate(() => {
      const { viewport } = window.emberlyHarness.tree;
      return { x: viewport.x, y: viewport.y, scale: viewport.scale.x };
    });
    const original = await page.screenshot();
    if (process.env.QA_OUTPUT) await page.screenshot({ path: path.join(process.env.QA_OUTPUT, "text-first-map.png") });
    for (let iteration = 0; iteration < 3; iteration++) {
      await page.evaluate(() => {
        (window.textEngine || window.emberlyHarness.engine).destroy();
        window.textEngine = window.emberlyHarness.create(window.emberlyHarness.mount);
      });
      await page.waitForFunction(() => window.textEngine.tree.isLoaded);
      // Allow the host's deferred initial fit to finish before matching the
      // first map's smoke-test controls and comparing the rendered result.
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        window.textEngine.fit(); window.textEngine.zoom(1); window.textEngine.zoom(-1);
        window.textEngine.toggleCollapse("right"); window.textEngine.toggleCollapse("right");
      });
      await page.waitForTimeout(4000);
      // Compare glyph rendering at exactly the same camera transform, independent
      // of the legacy initial-load animation timing.
      await page.evaluate(({ x, y, scale }) => {
        const { tree } = window.textEngine;
        tree.viewport.position.set(x, y); tree.viewport.scale.set(scale);
        tree.setTickDirty();
      }, view);
      await page.waitForTimeout(100);
      if (process.env.QA_OUTPUT) await page.screenshot({ path: path.join(process.env.QA_OUTPUT, `text-reopened-${iteration}.png`) });
      assert.deepEqual(await glyphs(), originalGlyphs, "Reopening a map preserves glyph drawing offsets");
      assert.ok(original.equals(await page.screenshot()), "Reopened map renders identical labels");
    }
    await page.evaluate(() => window.textEngine.destroy());
    assert.deepEqual(errors, []);
    console.log("PASS: glyph offsets and rendered labels remain identical through three map rebuilds");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
