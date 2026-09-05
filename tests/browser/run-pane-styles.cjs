const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<main class="emberly-topic-pane"><div class="emberly-topic-chrome"><div class="emberly-resource-header"></div></div></main>');
    await page.addStyleTag({ path: path.resolve(__dirname, "../../styles.css") });
    // Compare flat flex children against the previous display:contents layout,
    // including wrapping and the edit buttons, at narrow and wide pane sizes.
    const layouts = await page.evaluate(() => {
      const host = document.querySelector(".emberly-resource-header");
      const checks = [];
      for (const width of [220, 360, 620]) {
        host.style.width = `${width}px`;
        for (const editing of [false, true]) {
          for (const tags of [[], ["gulls"], ["gulls", "birds/coastal", "a-very-long-tag-that-wraps-onto-another-line", "field-notes"]]) {
            const makeRow = (wrapped) => {
              const row = document.createElement("div");
              row.className = "emberly-resource-header-tags";
              let parent = row;
              if (wrapped) { parent = document.createElement("div"); parent.style.display = "contents"; row.append(parent); }
              for (const tag of tags) {
                const chip = document.createElement("span"); chip.className = "emberly-resource-tag-chip";
                const text = document.createElement("span"); text.textContent = tag; chip.append(text);
                if (editing) { const button = document.createElement("button"); button.textContent = "×"; chip.append(button); }
                parent.append(chip);
              }
              const toggle = document.createElement("button"); toggle.className = "emberly-resource-text-button";
              toggle.textContent = "add/remove tag"; row.append(toggle); host.append(row);
              return row;
            };
            const measure = (row) => {
              const origin = row.getBoundingClientRect();
              return [...row.querySelectorAll(".emberly-resource-tag-chip, .emberly-resource-text-button")].map((element) => {
                const box = element.getBoundingClientRect();
                return [box.x - origin.x, box.y - origin.y, box.width, box.height];
              });
            };
            const before = makeRow(true), after = makeRow(false);
            checks.push({ before: measure(before), after: measure(after) });
            before.remove(); after.remove();
          }
        }
      }
      return checks;
    });
    for (const { before, after } of layouts) assert.deepEqual(after, before, "Tag layout remains identical after removing the wrapper");
    const visibility = await page.evaluate(() => {
      const pane = document.querySelector("main");
      pane.innerHTML = `<div class="view-content">
        <div class="emberly-topic-chrome"><div class="emberly-topic-header">Header</div><div class="emberly-topic-tabs">Tabs</div><div class="emberly-resource-move-picker">Move</div>
          <div class="emberly-resource-header"><form class="emberly-resource-tag-form" hidden>Tag form</form></div></div>
        <div class="emberly-map-settings-panel" hidden>Settings</div>
        <div class="emberly-topic-resource-panel"><div class="emberly-resource-upload"><input type="file" hidden></div><div class="emberly-topic-resource-list">Resources</div>
          <div class="emberly-resource-create-page"><div class="emberly-resource-create-form"><button class="emberly-resource-file-picker" hidden>Choose file</button><button class="emberly-resource-create-submit" hidden>Create</button></div></div></div></div>`;
      const popup = document.createElement("div"); popup.className = "emberly-topic-header-popup"; popup.hidden = true; document.body.append(popup);
      const visible = (selector) => getComputedStyle(document.querySelector(selector)).display !== "none";
      const hiddenControls = [...document.querySelectorAll("[hidden]")].every((el) => getComputedStyle(el).display === "none");
      const picker = document.querySelector(".emberly-resource-file-picker");
      picker.hidden = false;
      const pickerVisible = visible(".emberly-resource-file-picker");
      pane.classList.add("emberly-resource-creating");
      const creation = [".emberly-topic-chrome", ".emberly-resource-upload", ".emberly-topic-resource-list"].every((s) => !visible(s));
      pane.classList.replace("emberly-resource-creating", "emberly-resource-moving");
      const moving = !visible(".emberly-topic-header") && !visible(".emberly-topic-tabs") && visible(".emberly-resource-move-picker");
      pane.classList.remove("emberly-resource-moving");
      const restored = visible(".emberly-topic-header") && visible(".emberly-topic-tabs");
      return { hiddenControls, pickerVisible, creation, moving, restored };
    });
    for (const [name, passed] of Object.entries(visibility)) assert.equal(passed, true, name);
    assert.deepEqual(errors, []);
    console.log("PASS: 18 tag layouts match the previous layout; hidden controls, resource creation/moving and restoration behave correctly");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
