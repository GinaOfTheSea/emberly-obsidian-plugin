// Run after scripts/build/build-engine-smoke.mjs. Uses an existing Playwright install
// (PLAYWRIGHT_MODULE may be an absolute path); never downloads a browser.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    context.on("page", (page) => {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(__dirname, "engine-smoke.html")).href);
    await page.waitForFunction(() => window.emberlySmoke?.ok);
    await page.waitForTimeout(4000);
    assert.equal(await page.evaluate(() => "sc" in window), false);
    const point = (surface, id) => surface.evaluate((id) => {
      const node = window.emberlyHarness.tree.getNodeById(id);
      const rect = node.container.hitArea;
      const position = node.container.toGlobal({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      return { x: position.x, y: position.y };
    }, id);
    const snapshot = (surface) => surface.evaluate(() => {
      const { engine, tree, events } = window.emberlyHarness;
      return { selected: engine.selectedId(), collapse: engine.collapseState("right"),
        x: tree.viewport.x, y: tree.viewport.y, scale: tree.viewport.scale.x, writes: events.writes };
    });
    const clickTopic = async (surface, id) => {
      const position = await point(surface, id);
      await surface.mouse.click(position.x, position.y);
      await surface.waitForTimeout(350);
      assert.equal((await snapshot(surface)).selected, id);
    };
    await clickTopic(page, "right");
    await page.evaluate(() => window.emberlyHarness.engine.toggleCollapse("right"));
    await page.waitForTimeout(1200);
    const before = await snapshot(page);
    const popupEvent = page.waitForEvent("popup");
    await page.evaluate(() => { window.testPopout = window.open("about:blank", "emberly-test", "width=1000,height=700"); });
    const popup = await popupEvent;
    await popup.setViewportSize({ width: 1000, height: 700 });
    await page.evaluate(() => {
      const popup = window.testPopout;
      popup.document.head.innerHTML = "<style>html,body,#mount{width:100%;height:100%;margin:0;overflow:hidden}</style>";
      popup.emberlyHarness = window.emberlyHarness;
      popup.document.body.append(window.emberlyHarness.mount);
      window.emberlyHarness.migrate();
    });
    await popup.waitForTimeout(500);
    assert.deepEqual(await snapshot(popup), before, "Migration preserves viewport, selection, collapsed state and writes");
    await clickTopic(popup, "left");
    const wheelBefore = (await snapshot(popup)).scale;
    await popup.mouse.move(500, 500);
    await popup.mouse.wheel(0, -180);
    await popup.waitForTimeout(600);
    assert.notEqual((await snapshot(popup)).scale, wheelBefore, "Wheel works in the pop-out");
    const panBefore = await snapshot(popup);
    await popup.mouse.move(100, 100);
    await popup.mouse.down();
    await popup.mouse.move(170, 145, { steps: 8 });
    await popup.mouse.up();
    await popup.waitForTimeout(900);
    assert.notEqual((await snapshot(popup)).x, panBefore.x, "Canvas pan works in the pop-out");
    const left = await point(popup, "left");
    await popup.mouse.dblclick(left.x, left.y, { delay: 80 });
    assert.equal(await popup.evaluate(() => window.emberlyHarness.events.edit.at(-1)), "left", "Double click still opens editing");
    await popup.evaluate(() => window.emberlyHarness.engine.toggleCollapse("right"));
    await popup.waitForTimeout(1500);
    const returning = await snapshot(popup);
    await page.evaluate(() => {
      document.body.append(window.emberlyHarness.mount);
      window.emberlyHarness.migrate();
    });
    await popup.close();
    await page.waitForTimeout(500);
    assert.deepEqual(await snapshot(page), returning, "Returning and closing the pop-out preserves map state");
    await clickTopic(page, "right");
    assert.equal(await page.evaluate(() => window.emberlyHarness.mount.querySelectorAll("canvas").length), 1);
    await page.waitForTimeout(1500);
    const recoveryBefore = await page.screenshot();
    // Simulate the actual GPU loss/restore events supported by Pixi.
    const available = await page.evaluate(() => {
      const { tree } = window.emberlyHarness;
      window.contextExtension = tree.renderer.gl?.getExtension("WEBGL_lose_context");
      window.contextExtension?.loseContext();
      tree.setContextLost();
      return Boolean(window.contextExtension);
    });
    assert.equal(available, true);
    await page.waitForTimeout(100);
    await page.evaluate(() => window.contextExtension.restoreContext());
    await page.waitForTimeout(700);
    assert.ok(recoveryBefore.equals(await page.screenshot()), "GPU restoration repaints the same map");
    await clickTopic(page, "left");
    const child = await point(page, "child");
    const parent = await point(page, "left");
    const dragWrites = (await snapshot(page)).writes;
    await page.mouse.move(child.x, child.y);
    await page.mouse.down();
    await page.mouse.move(parent.x, parent.y, { steps: 30 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(1000);
    assert.notEqual(await page.evaluate(() => window.emberlyHarness.tree.getNodeById("child").entity.parentId), "right", "Topic drag still reparents using the legacy joint snapping");
    assert.ok((await snapshot(page)).writes > dragWrites, "Topic drag persists its change");
    const secondPopup = page.waitForEvent("popup");
    await page.evaluate(() => { window.testPopout = window.open("about:blank", "emberly-create"); });
    const freshPopup = await secondPopup;
    await page.evaluate(() => {
      const doc = window.testPopout.document;
      const container = doc.createElement("div");
      container.style.cssText = "width:800px;height:600px";
      doc.body.append(container);
      window.freshContainer = container;
      window.freshEngine = window.emberlyHarness.create(container);
      const pending = doc.createElement("div");
      doc.body.append(pending);
      window.emberlyHarness.create(pending).destroy();
    });
    await page.waitForFunction(() => window.freshEngine.focusTopic("left"));
    await page.evaluate(() => {
      document.body.append(window.freshContainer);
      window.emberlyHarness.migrate(window.freshContainer);
    });
    await freshPopup.close();
    await page.evaluate(() => {
      if (!window.freshEngine.focusTopic("right")) throw new Error("Pop-out-created map stopped after its window closed");
      window.freshEngine.destroy(); window.emberlyHarness.engine.destroy();
    });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelectorAll("canvas").length), 0);
    assert.deepEqual(errors, [], "No browser exceptions or console errors");
    console.log("PASS: selection, collapse, wheel, pan, topic drag, double click, migration both ways, identical GPU restoration, pop-out creation and early/normal disposal");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
