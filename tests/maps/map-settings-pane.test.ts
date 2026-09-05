// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownView } from "obsidian";
import { TopicNotePane } from "../../src/topics/topic-note-pane";
import { MapSettingsPane, type MapSettingsActions } from "../../src/maps/map-settings-pane";
import { ResourceFixture, note } from "../helpers/resource-fixture";
import { installObsidianDom } from "../helpers/obsidian-dom";

vi.mock("../../src/resources/resource-tag-suggest", () => ({ ResourceTagSuggest: class { close() {} } }));

describe("map settings inside the native note pane (isolated DOM)", () => {
  let fixture: ResourceFixture, pane: TopicNotePane, host: HTMLElement, view: MarkdownView, editor: HTMLElement;
  let actions: MapSettingsActions;
  const tab = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.startsWith(name))!;
  const show = (path: string) => { view.file = fixture.index.file(path)!; pane.update(); };
  beforeEach(async () => {
    installObsidianDom(); fixture = await ResourceFixture.create();
    host = document.body.createDiv(); const contentEl = host.createDiv({ cls: "view-content" });
    editor = contentEl.createDiv({ cls: "markdown-source-view", text: "User's native root notes" });
    view = { app: fixture.app, containerEl: host, contentEl, file: fixture.index.file("a/Map.md"), getViewData: () => "User's native root notes",
      addAction: (_icon: string, title: string, action: () => void) => {
        const button = host.createEl("button", { attr: { "aria-label": title } }); button.addEventListener("click", action); return button;
      },
    } as unknown as MarkdownView;
    actions = { rename: vi.fn(async () => {}), layout: vi.fn(async () => {}), center: vi.fn(async () => {}),
      icons: vi.fn(async () => {}), duplicate: vi.fn(async () => {}), move: vi.fn(), trash: vi.fn(async () => {}) };
    pane = new TopicNotePane(view, fixture.index, vi.fn(async () => {}), async () => ({ color: -1, rating: 0, state: 0 }),
      async () => ({ rating: 0, tags: [] }), async () => ({ added: 0, paths: [], errors: [] }), () => ({ choose() {}, cancel() {} }), actions);
  });
  afterEach(async () => { pane.dispose(); document.body.replaceChildren(); await fixture.dispose(); });

  it("opens root settings, replaces topic controls, and retains native notes as a tab", () => {
    const before = fixture.mutations.slice();
    expect(host.classList.contains("emberly-map-show-settings")).toBe(true);
    expect(host.querySelector<HTMLElement>(".emberly-topic-header")!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>(".emberly-map-settings-header")!.hidden).toBe(false);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Map name"]')!.value).toBe("Map");
    expect(tab("Settings").getAttribute("aria-selected")).toBe("true");
    tab("Notes").click(); expect(host.classList.contains("emberly-map-show-settings")).toBe(false);
    pane.update(); expect(tab("Notes").getAttribute("aria-selected")).toBe("true");
    expect(tab("Resources").hidden).toBe(true);
    pane.showFile({ section: "settings" }); expect(tab("Settings").getAttribute("aria-selected")).toBe("true");
    expect(view.contentEl.querySelector(".markdown-source-view")).toBe(editor);
    expect(editor.textContent).toBe("User's native root notes"); expect(fixture.mutations).toEqual(before);
  });

  it("follows native topic/resource/root navigation and never offers settings to an orphan", () => {
    show("a/Topics/one.md");
    expect(tab("Settings").hidden).toBe(true);
    expect(host.querySelector<HTMLElement>(".emberly-topic-header")!.hidden).toBe(false);
    expect(host.classList.contains("emberly-map-show-settings")).toBe(false);
    pane.showFile({ section: "settings" }); expect(tab("Notes").getAttribute("aria-selected")).toBe("true");
    show("a/Resources/Guide.md"); expect(host.querySelector<HTMLElement>(".emberly-resource-header")!.hidden).toBe(false);
    show("a/Map.md"); expect(tab("Settings").getAttribute("aria-selected")).toBe("true");
    show("a/Topics/one.md");
    const file = view.file!;
    fixture.index.setContent(file.path, note({ ...fixture.index.propertiesFor(file), "emberly-map": "missing" }));
    pane.update(); expect(tab("Settings").hidden).toBe(true);
    expect(host.classList.contains("emberly-map-show-settings")).toBe(false);
  });

  it("supports keyboard tabs, layout actions and external metadata/name refresh without losing a draft", async () => {
    tab("Settings").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(tab("Notes").getAttribute("aria-selected")).toBe("true");
    tab("Notes").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(tab("Notes").getAttribute("aria-selected")).toBe("true");
    tab("Notes").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    const input = host.querySelector<HTMLInputElement>('[aria-label="Map name"]')!;
    input.focus(); input.value = "A draft"; input.dispatchEvent(new Event("input")); pane.update();
    expect(input.value).toBe("A draft");
    host.querySelector<HTMLButtonElement>('[aria-label="Branch layout"]')!.click();
    expect(actions.layout).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "branch");
    await vi.waitFor(() => expect(host.querySelector(".emberly-map-settings-status")?.textContent).toBe(""));
    const mapFile = fixture.index.file("a/Map.md")!;
    await fixture.app.fileManager.renameFile(mapFile, "a/Renamed.md");
    fixture.index.setContent(mapFile.path, note({ ...fixture.index.propertiesFor(mapFile), "emberly-layout": "branch" }));
    input.blur(); pane.update();
    expect(input.value).toBe("Renamed");
    expect(host.querySelector('[aria-label="Branch layout"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-label="Center layout"]')!.getAttribute("aria-pressed")).toBe("false");
  });

  it("cleans up only plugin DOM and presentation state", () => {
    pane.dispose();
    expect(host.querySelector(".emberly-map-settings-panel")).toBeNull();
    expect(host.classList.contains("emberly-map-show-settings")).toBe(false);
    expect(view.contentEl.querySelector(".markdown-source-view")).toBe(editor);
  });

  it("reports save errors, prevents double saves, and ignores completions after navigation/disposal", async () => {
    let reject!: (error: Error) => void;
    const rename = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const settings = new MapSettingsPane(host, { rename, layout: vi.fn(async () => {}), center: vi.fn(async () => {}),
      icons: vi.fn(async () => {}), duplicate: vi.fn(async () => {}), move: vi.fn(), trash: vi.fn(async () => {}) });
    const a = fixture.index.maps().find((map) => map.id === "a")!, b = fixture.index.maps().find((map) => map.id === "b")!;
    settings.update(a);
    const input = settings.container.querySelector("input")!, form = settings.container.querySelector("form")!;
    input.value = "Renamed"; input.dispatchEvent(new Event("input"));
    form.dispatchEvent(new Event("submit", { cancelable: true })); form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(rename).toHaveBeenCalledOnce();
    reject(new Error("Filename occupied"));
    await vi.waitFor(() => expect(settings.container.textContent).toContain("Filename occupied"));
    expect(input.disabled).toBe(false);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    settings.update(b); reject(new Error("Old request failed"));
    await Promise.resolve(); await Promise.resolve();
    expect(settings.container.textContent).not.toContain("Old request failed");
    expect(input.value).toBe(b.title); expect(input.disabled).toBe(false);
    input.value = "Another"; input.dispatchEvent(new Event("input"));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    settings.dispose(); reject(new Error("Disposed"));
    await Promise.resolve(); expect(settings.container.isConnected).toBe(false);
  });
});
