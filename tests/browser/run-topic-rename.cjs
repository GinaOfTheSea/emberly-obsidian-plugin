const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { build } = require("esbuild");
const assert = require("node:assert/strict");
const path = require("node:path");

(async () => {
  // Exercise the real header with only Obsidian's DOM/icon adapter substituted.
  const bundle = await build({
    stdin: { contents: `
      import { TopicHeader } from './src/topics/topic-header';
      import { installObsidianDom } from './tests/helpers/obsidian-dom';
      installObsidianDom();
      const file = { path: 'Topics/Lesser Black-backed Gull.md', get basename() { return this.path.slice(7, -3); } };
      window.renames = [];
      new TopicHeader(document.querySelector('main'), async (_file, _identity, change) => ({ color: -1, rating: change.rating ?? 0, state: 0 }), () => true,
        async (file, identity, name, expectedPath) => {
          window.renames.push({ name, expectedPath });
          if (!name.trim()) throw new Error('Enter a note name.');
          await new Promise(resolve => setTimeout(resolve, 20));
          file.path = 'Topics/' + name + '.md';
        }).update(file, { emberly: 'topic', 'emberly-format': 2, 'emberly-id': 'gull', 'emberly-map': 'seagulls' });
    `, resolveDir: path.resolve(__dirname, "../.."), loader: "ts" },
    bundle: true, write: false, platform: "browser",
    plugins: [{ name: "obsidian-dom-adapter", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "adapter" }));
      builder.onLoad({ filter: /.*/, namespace: "adapter" }, () => ({ contents: 'export class Notice {} export function setIcon() {}' }));
    } }],
  });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://localhost/topic-rename", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Topic rename test</title>" }));
    await page.goto("http://localhost/topic-rename");
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const width of [240, 560]) {
      await page.setContent(`<body class="theme-light"><main style="width:${width}px"></main><button id="outside">Outside</button></body>`);
      if (process.env.OBSIDIAN_APP_CSS) await page.addStyleTag({ path: process.env.OBSIDIAN_APP_CSS });
      await page.addStyleTag({ path: path.resolve(__dirname, "../../styles.css") });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      assert.deepEqual(errors, []);
      const title = page.locator(".emberly-topic-header-title");
      const before = await title.boundingBox();
      if (process.env.RENAME_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.RENAME_SCREENSHOT_DIR, `topic-title-${width}.png`) });
      await title.click();
      assert.equal(await page.evaluate(() => getSelection().toString()), "Lesser Black-backed Gull");
      assert.deepEqual(await title.boundingBox(), before, "editing must not shift the header");
      if (process.env.RENAME_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.RENAME_SCREENSHOT_DIR, `topic-rename-${width}.png`) });
      await page.keyboard.insertText("Common Gull");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector('h2').getAttribute('role') === 'button');
      assert.equal(await title.textContent(), "Common Gull");
      await title.press("Enter");
      await page.keyboard.insertText("Discard this");
      await page.keyboard.press("Escape");
      assert.equal(await title.textContent(), "Common Gull");
      await title.click();
      await page.keyboard.insertText("Herring Gull");
      await page.locator("#outside").click();
      await page.waitForFunction(() => document.querySelector('h2').getAttribute('role') === 'button');
      assert.equal(await page.evaluate(() => document.activeElement.id), "outside");
      await title.click();
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector('h2').getAttribute('aria-invalid') === 'true');
      await page.keyboard.insertText("Little Gull");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector('h2').getAttribute('role') === 'button');
      assert.equal(await title.textContent(), "Little Gull");
      assert.equal(await page.evaluate(() => window.renames.length), 4);
      await page.getByRole("button", { name: "Add rating", exact: true }).click();
      const picker = page.locator(".emberly-topic-rating-picker");
      const filled = () => picker.locator(".is-filled").count();
      await picker.getByRole("button", { name: "3 out of 5", exact: true }).hover();
      assert.equal(await filled(), 3);
      await picker.getByRole("button", { name: "5 out of 5", exact: true }).hover();
      assert.equal(await filled(), 5);
      await picker.getByRole("button", { name: "1 out of 5", exact: true }).hover();
      assert.equal(await filled(), 1);
      await page.getByRole("button", { name: "Clear rating", exact: true }).hover();
      assert.equal(await filled(), 0, "hover alone must not save a rating");
      await picker.getByRole("button", { name: "3 out of 5", exact: true }).click();
      await page.getByRole("button", { name: "Change rating, 3 out of 5", exact: true }).click();
      await picker.getByRole("button", { name: "1 out of 5", exact: true }).hover();
      assert.equal(await filled(), 1);
      await page.getByRole("button", { name: "Clear rating", exact: true }).hover();
      assert.equal(await filled(), 3, "leaving restores the saved rating");
      await page.keyboard.press("Escape");
    }
    assert.deepEqual(errors, []);
    console.log("Topic header: inline rename and cumulative rating hover/save/restore passed at two pane widths.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
