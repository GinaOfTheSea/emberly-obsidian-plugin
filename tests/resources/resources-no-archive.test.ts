// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownView } from "obsidian";
import { TopicNotePane } from "../../src/topics/topic-note-pane";
import { readResourceSettings, resourceProperties, type ResourceChange } from "../../src/resources/resource-properties";
import { ResourceFixture, note } from "../helpers/resource-fixture";
import { installObsidianDom } from "../helpers/obsidian-dom";

const menus = vi.hoisted(() => [] as string[][]);
vi.mock("../../src/resources/resource-tag-suggest", () => ({ ResourceTagSuggest: class { close() {} } }));
vi.mock("obsidian", async (original) => ({ ...await original<object>(),
  Menu: class {
    titles: string[] = []; hidden?: () => void;
    constructor() { menus.push(this.titles); }
    setUseNativeMenu() {}
    addItem(callback: (item: any) => void) {
      const item = { setTitle: (title: string) => { this.titles.push(title); return item; }, setIcon: () => item, onClick: () => item };
      callback(item);
    }
    onHide(callback: () => void) { this.hidden = callback; }
    hide() { this.hidden?.(); }
    showAtPosition() {}
  },
}));

describe("resources without archive (isolated DOM and fixture vault)", () => {
  let fixture: ResourceFixture, pane: TopicNotePane | undefined, host: HTMLElement, view: MarkdownView;
  let body: string;
  const show = async (path: string) => {
    view.file = fixture.index.file(path)!; body = await fixture.read(path);
    pane!.showFile({ section: "resources" });
  };
  beforeEach(async () => {
    installObsidianDom(); menus.length = 0;
    fixture = await ResourceFixture.create();
    host = document.body.createDiv(); const contentEl = host.createDiv();
    body = await fixture.read("a/Topics/one.md");
    view = { app: fixture.app, containerEl: host, contentEl, file: fixture.index.file("a/Topics/one.md"), getViewData: () => body,
      addAction: (_icon: string, title: string, action: () => void) => {
        const button = host.createEl("button", { attr: { "aria-label": title } }); button.addEventListener("click", action); return button;
      },
    } as unknown as MarkdownView;
  });
  const mount = () => {
    pane = new TopicNotePane(view, fixture.index, vi.fn(async () => {}), async () => ({ color: -1, rating: 0, state: 0 }),
      async () => ({ rating: 0, tags: [] }), async () => ({ added: 0, paths: [], errors: [] }), () => ({ choose() {}, cancel() {} }),
      { rename: vi.fn(async () => {}), layout: vi.fn(async () => {}), center: vi.fn(async () => {}),
        icons: vi.fn(async () => {}), duplicate: vi.fn(async () => {}), move: vi.fn(), trash: vi.fn(async () => {}) });
    pane.showFile({ section: "resources" });
  };
  afterEach(async () => { pane?.dispose(); pane = undefined; document.body.replaceChildren(); await fixture.dispose(); });

  it.each(["archived", "emberly-archived"])("keeps %s resources visible and counted without changing their files", async (flag) => {
    const resource = fixture.index.resourceCatalog().resources[0]!;
    const file = fixture.index.file(resource.path)!;
    const properties = { ...fixture.index.propertiesFor(file), [flag]: true };
    const content = note(properties, "# Keep this note exactly\n");
    await fixture.app.vault.process(file, () => content); fixture.index.setContent(file.path, content);
    mount();
    expect(host.querySelectorAll(".emberly-resource-row")).toHaveLength(1);
    expect(host.querySelector('[role="tab"]:not([hidden])')?.textContent).toBe("Resources (1)");
    expect(host.querySelector(".emberly-resource-archive-toggle")).toBeNull();
    expect(host.querySelector(".emberly-resource-upload-hint")).toBeNull();
    expect(host.querySelector(".emberly-resource-tags")?.textContent ?? "").not.toContain("Archived");
    expect(fixture.index.maps().find((map) => map.id === "a")!.nodes.find((node) => node.id === resource.topicId)!.state & 4).toBe(4);
    await show(file.path);
    expect(host.querySelector(".emberly-resource-header .emberly-resource-bar-title")?.textContent).toBe("Resource");
    host.querySelector<HTMLButtonElement>('[aria-label="Resource options"]')!.click();
    expect(menus.at(-1)).toEqual(["Move…", "Show note details"]);
    expect(await fixture.read(file.path)).toBe(content);
  });

  it("keeps the empty state concise and Add resource functional", async () => {
    mount(); await show("a/Topics/two.md");
    expect(host.querySelector(".emberly-resource-empty")?.textContent).toBe("No resources on this topic yet.");
    expect(host.textContent).not.toContain("Save a web link or attach any file.");
    expect(host.textContent).not.toContain("Show archived");
    host.querySelector<HTMLButtonElement>(".emberly-resource-upload-button")!.click();
    expect(host.querySelector<HTMLElement>(".emberly-resource-create-page")!.hidden).toBe(false);
  });

  it("ignores archive settings and rejects archive writes while preserving unrelated properties", () => {
    const properties = { archived: true, "emberly-archived": true, "emberly-rating": 2, tags: ["research"] };
    expect(readResourceSettings(properties)).toEqual({ rating: 2, tags: ["research"] });
    expect(() => resourceProperties(properties, { archived: false } as unknown as ResourceChange)).toThrow("Invalid resource setting");
    expect({ ...properties, ...resourceProperties(properties, { rating: 3 }) }).toEqual({ ...properties, "emberly-rating": 3 });
  });
});
