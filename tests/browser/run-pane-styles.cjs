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
    // Use installed Obsidian CSS for local verification when available. The
    // small fallback models its public mode/property classes for portable CI.
    if (process.env.OBSIDIAN_APP_CSS) await page.addStyleTag({ path: process.env.OBSIDIAN_APP_CSS });
    else await page.addStyleTag({ content: `
      .markdown-reading-view { display: flex; }
      .markdown-source-view .metadata-container, .markdown-preview-view .metadata-container:not(.mod-error) { display: none; }
      .markdown-source-view.is-live-preview.show-properties .metadata-container:not(.mod-error) { display: var(--metadata-display-editing, block); }
      .markdown-preview-view.show-properties .metadata-container { display: var(--metadata-display-reading, block); }
      .markdown-source-view.is-live-preview.show-properties .metadata-container[data-property-count="0"]:not(.mod-error),
      .markdown-preview-view.show-properties .metadata-container[data-property-count="0"]:not(.mod-error) { display: none; }
    ` });
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
    const nativeStates = await page.evaluate(() => {
      document.body.classList.add("show-inline-title");
      const pane = document.querySelector("main");
      pane.className = "workspace-leaf-content emberly-topic-pane emberly-integrated-pane";
      pane.innerHTML = `<div class="view-content"><div class="emberly-integrated-map">Map</div>
        <div class="markdown-source-view is-live-preview show-properties"><div class="inline-title">Title</div><div class="metadata-container" data-property-count="0">Properties</div></div>
        <div class="markdown-reading-view"><div class="markdown-preview-view show-properties"><div class="inline-title">Title</div><div class="metadata-container" data-property-count="0">Properties</div></div></div></div>`;
      const source = pane.querySelector(".markdown-source-view"), reading = pane.querySelector(".markdown-reading-view");
      const visible = (el) => getComputedStyle(el).display !== "none";
      const checks = {};
      for (const mode of ["source", "reading"]) {
        // Obsidian's hide() sets display:none; show() removes that override.
        source.style.display = mode === "source" ? "" : "none";
        reading.style.display = mode === "reading" ? "" : "none";
        for (const state of ["notes", "resources", "settings", "moving", "collapsed"]) {
          pane.className = "workspace-leaf-content emberly-topic-pane emberly-integrated-pane";
          const stateClass = { resources: "emberly-topic-show-resources", settings: "emberly-map-show-settings", moving: "emberly-resource-moving", collapsed: "emberly-integrated-collapsed" }[state];
          if (stateClass) pane.classList.add(stateClass);
          checks[`${mode}/${state}`] = visible(source) === (state === "notes" && mode === "source")
            && visible(reading) === (state === "notes" && mode === "reading")
            && visible(pane.querySelector(".emberly-integrated-map"));
        }
      }
      pane.className = "workspace-leaf-content emberly-topic-pane";
      source.style.display = reading.style.display = "";
      const metadata = [...pane.querySelectorAll(".metadata-container")];
      for (const count of ["0", "2"]) {
        metadata.forEach((el) => el.dataset.propertyCount = count);
        for (const details of [false, true]) {
          pane.classList.toggle("emberly-topic-details-visible", details);
          checks[`properties/${count}/${details}`] = metadata.every((el) => visible(el) === details);
        }
      }
      source.classList.remove("is-live-preview");
      checks.rawSource = !visible(source.querySelector(".metadata-container"));
      pane.classList.remove("emberly-topic-details-visible");
      metadata.forEach((el) => el.classList.add("mod-error"));
      checks.propertyErrors = metadata.every(visible);
      pane.classList.add("emberly-topic-with-header");
      checks.duplicateTitles = [...pane.querySelectorAll(".inline-title")].every((el) => !visible(el));
      pane.classList.remove("emberly-topic-with-header");
      checks.titlesRestored = [...pane.querySelectorAll(".inline-title")].every(visible);
      return checks;
    });
    for (const [state, passed] of Object.entries(nativeStates)) assert.equal(passed, true, `Native ${state}`);
    assert.deepEqual(errors, []);
    console.log("PASS: 18 tag layouts match; controls, native modes, collapsed inspector, properties/errors and titles behave correctly");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
