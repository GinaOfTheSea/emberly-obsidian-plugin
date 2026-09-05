// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest, TFile } from "obsidian";
import EmberlyMapsPlugin from "../../src/main";
import { EmberlyVaultIndex } from "../../src/vault/vault-index";
import { MarkdownNodeCollection } from "../../src/emberly-engine/adapter/markdown-collection";
import { createResources } from "../../src/resources/resource-create";
import { frontmatter } from "../../src/vault/vault-files";
import { appearanceProperties } from "../../src/topics/topic-appearance";
import type { EmberlyMap } from "../../src/shared/types";
import { ResourceFixture, note } from "../helpers/resource-fixture";
import { writeFile } from "node:fs/promises";

vi.mock("../../src/maps/map-view", () => ({ EmberlyMapView: class {}, VIEW_TYPE_EMBERLY_MAP: "map" }));
vi.mock("../../src/maps/integrated-map-pane", () => ({ IntegratedMapPane: class {} }));
vi.mock("../../src/topics/topic-note-pane", () => ({ TopicNotePane: class {} }));
const dialogs = vi.hoisted(() => [] as { title: string; submit: (name: string) => Promise<void> }[]);
vi.mock("../../src/ui/modals", () => ({ MapPickerModal: class {}, NameModal: class {
  constructor(_app: App, public title: string, _placeholder: string, public submit: (name: string) => Promise<void>) {}
  open() { dialogs.push(this); }
}, TopicNamesModal: class {
  constructor(_app: App, public title: string, public submit: (name: string) => Promise<void>) {}
  open() { dialogs.push(this); }
} }));
vi.mock("../../src/emberly-engine/renderer-assets", () => ({ loadEmberlyFonts() {}, unloadEmberlyFonts() {} }));
vi.mock("obsidian", async (original) => ({ ...await original<object>(),
  Plugin: class { constructor(public app: App) {} }, MarkdownView: class {}, normalizePath: (path: string) => path,
}));

type PrivateAPI = {
  createMap(name: string): Promise<EmberlyMap>;
  createTopic(map: EmberlyMap, name: string, parent: string): Promise<TFile>;
  renameNote(file: TFile, name: string): Promise<void>;
  renameTopic(file: TFile, identity: { id: string; mapId: string }, name: string, expectedPath: string): Promise<void>;
  updateProperties(file: TFile, update: Record<string, unknown>, root?: boolean): Promise<Record<string, unknown>>;
};

describe("filename authority and lean writes through public vault APIs", () => {
  let fixture: ResourceFixture, plugin: EmberlyMapsPlugin, api: PrivateAPI;
  beforeEach(async () => {
    dialogs.length = 0;
    fixture = await ResourceFixture.create();
    Object.assign(fixture.app, { workspace: { iterateAllLeaves() {}, getLeavesOfType: () => [], detachLeavesOfType() {} } });
    plugin = new EmberlyMapsPlugin(fixture.app, {} as PluginManifest);
    plugin.index = fixture.index;
    api = plugin as unknown as PrivateAPI;
  });
  afterEach(async () => { plugin.onunload(); vi.restoreAllMocks(); await fixture.dispose(); });

  it("opens the format-2 child dialog and saves through the normal fractional hierarchy", async () => {
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    plugin.promptForTopic(map, "a-one");
    expect(dialogs).toHaveLength(1);
    await dialogs[0]!.submit("New child");
    const saved = fixture.index.maps().find((map) => map.id === "a")!;
    expect(saved.issues).toEqual([]);
    expect(saved.nodes.find((node) => node.title === "New child")).toMatchObject({ parentId: "a-one", order: "a1" });
  });

  it("saves a topic batch in order with normal sanitization and duplicate suffixes", async () => {
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    plugin.promptForTopic(map, "a-one");
    for (const name of ["First/name", "Second", "Second"]) await dialogs[0]!.submit(name);
    const created = fixture.index.maps().find((map) => map.id === "a")!.nodes.filter((node) => node.parentId === "a-one");
    expect(created.map((node) => [node.title, node.order])).toEqual([["two", "a0"], ["First-name", "a1"], ["Second", "a2"], ["Second (2)", "a3"]]);
  });

  it("propagates write failures for retry but acknowledges saved files if map refresh fails", async () => {
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    plugin.promptForTopic(map, "a-one");
    fixture.failCreate = true;
    await expect(dialogs[0]!.submit("Retry me")).rejects.toThrow("disk full");
    fixture.failCreate = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(plugin as unknown as { addTopicToViews(): void }, "addTopicToViews").mockImplementation(() => { throw new Error("View unavailable"); });
    await expect(dialogs[0]!.submit("Retry me")).resolves.toBeUndefined();
    expect(fixture.index.maps().find((map) => map.id === "a")!.nodes.filter((node) => node.title === "Retry me")).toHaveLength(1);
  });

  it("creates siblings under the same parent on the selected branch side without changing existing notes", async () => {
    const file = fixture.index.file("a/Topics/one.md")!;
    await api.updateProperties(file, { "emberly-side": "left" });
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    const before = new Map(await Promise.all(fixture.index.sources().map(async (source) => [source.path, await fixture.read(source.path)] as const)));
    plugin.promptForTopic(map, "a-one", true);
    expect(dialogs[0]?.title).toBe("Add siblings of one");
    await dialogs[0]!.submit("New sibling");
    const saved = fixture.index.maps().find((map) => map.id === "a")!;
    expect(saved.issues).toEqual([]);
    expect(saved.nodes.find((node) => node.title === "New sibling")).toMatchObject({ parentId: "a-root", side: "left", order: "a1" });
    for (const [path, body] of before) expect(await fixture.read(path)).toBe(body);
  });

  it("rejects missing/root sibling selections and invalid maps without opening a creation dialog", () => {
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    plugin.promptForTopic(map, null, true);
    plugin.promptForTopic(map, "a-root", true);
    plugin.promptForTopic(map, "missing", true);
    const maps = vi.spyOn(fixture.index, "maps");
    maps.mockReturnValue([{ ...map, issues: ["Missing parent"] }]);
    plugin.promptForTopic(map, "a-one");
    maps.mockReturnValue([{ ...map, format: 1 }]);
    plugin.promptForTopic(map, "a-one");
    expect(dialogs).toHaveLength(0);
  });

  it("creates maps/topics with sanitized filenames, collision suffixes, short IDs and no title/dates/defaults", async () => {
    const map = await api.createMap("My/map");
    expect(map.title).toBe("My-map");
    expect(map.path).toBe("Emberly Maps/My-map/My-map.emberly.md");
    expect(map.id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{16}$/);
    const root = map.nodes[0]!;
    const notes = await Promise.all([api.createTopic(map, "Topic: A", root.id), api.createTopic(map, "Topic: A", root.id)]);
    expect(notes.map((file) => file.basename)).toEqual(["Topic- A", "Topic- A (2)"]);
    for (const path of [map.path, root.path, ...notes.map((file) => file.path)]) {
      const fm = frontmatter(await fixture.read(path)).properties;
      expect(fm["emberly-id"]).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{16}$/);
      for (const key of ["title", "created", "modified", "emberly-side", "emberly-color", "emberly-collapsed", "emberly-rating", "emberly-state"]) expect(fm).not.toHaveProperty(key);
      if (fm.emberly === "topic") expect(Object.keys(fm)).toHaveLength(7);
      if (fm.emberly === "topic") expect(frontmatter(await fixture.read(path)).body.trim()).toBe("");
    }
    const ids = fixture.index.sources().map((source) => source.frontmatter["emberly-id"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("resource");
    expect(fixture.index.maps().find((candidate) => candidate.id === map.id)?.issues).toEqual([]);
    const reloaded = new EmberlyVaultIndex(fixture.app); await reloaded.initialize();
    const reloadedMap = reloaded.maps().find((candidate) => candidate.id === map.id)!;
    expect(reloadedMap.nodes.map((node) => node.title).sort()).toEqual(["My-map", "Topic- A", "Topic- A (2)"]);
    expect(reloadedMap.nodes.every((node) => (node.state & 8) === 0)).toBe(true);
  });

  it("creates resource notes using their final filename, including attachment extensions and suffixes", async () => {
    const target = fixture.target("a", "one");
    const results = [];
    for (const _ of [1, 2]) results.push(await createResources(fixture.app, fixture.index, target,
      { kind: "offline", files: [], title: "Manual.pdf" }, () => {}));
    expect(results.flatMap((result) => result.errors)).toEqual([]);
    const resources = fixture.index.resourceCatalog().resources.filter((resource) => resource.id !== "resource");
    expect(resources.map((resource) => resource.title).sort()).toEqual(["Manual.pdf", "Manual.pdf (2)"]);
    expect(new Set(resources.map((resource) => resource.id)).size).toBe(2);
    for (const resource of resources) {
      const created = frontmatter(await fixture.read(resource.path));
      const fm = created.properties;
      expect(fm).not.toHaveProperty("title"); expect(fm).not.toHaveProperty("created"); expect(fm).not.toHaveProperty("modified");
      expect(fm["emberly-id"]).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{16}$/);
      expect(created.body).toBe("");
    }
  });

  it("resets settings by deleting keys and keeps dates, body, IDs and nonzero note/plan bits", async () => {
    const file = fixture.index.file("a/Topics/one.md")!;
    const fm = { ...fixture.index.propertiesFor(file), created: "1999-01-01", modified: "2000-01-01", custom: ["keep"],
      "emberly-color": 123, "emberly-rating": 5, "emberly-state": 10, "emberly-collapsed": true, "emberly-side": "left" };
    const body = "# Independent heading\n\nKeep [[two]] exactly.\n";
    const content = note(fm, body);
    await fixture.app.vault.process(file, () => content); fixture.index.setContent(file.path, content);
    await api.updateProperties(file, { "emberly-color": -1, "emberly-rating": 0, "emberly-collapsed": false, "emberly-side": "right",
      ...appearanceProperties(fm, { plan: 0 }) });
    const saved = frontmatter(await fixture.read(file.path));
    for (const key of ["emberly-color", "emberly-rating", "emberly-collapsed", "emberly-side"]) expect(saved.properties).not.toHaveProperty(key);
    expect(saved.properties).toMatchObject({ "emberly-state": 8, "emberly-id": "a-one", "emberly-map": "a", created: fm.created, modified: fm.modified, custom: fm.custom });
    expect(saved.body).toBe(body);
    const reload = new EmberlyVaultIndex(fixture.app); await reload.initialize();
    expect(reload.maps().find((map) => map.id === "a")!.nodes.find((node) => node.id === "a-one")).toMatchObject({ color: -1, rating: 0, collapsed: false, side: "right", state: 12 });
    await api.updateProperties(file, { "emberly-state": 0 });
    expect(frontmatter(await fixture.read(file.path)).properties).not.toHaveProperty("emberly-state");
  });

  it("preserves explicit left/color/collapse/rating/state across reload and derives root side from layout", async () => {
    const file = fixture.index.file("a/Topics/two.md")!;
    await api.updateProperties(file, { "emberly-color": 0, "emberly-rating": 4, "emberly-collapsed": true, "emberly-side": "left", "emberly-state": 9 });
    await plugin.setMapLayout(fixture.index.maps().find((map) => map.id === "a")!, "branch");
    const reload = new EmberlyVaultIndex(fixture.app); await reload.initialize();
    const map = reload.maps().find((map) => map.id === "a")!;
    expect(map.nodes.find((node) => node.id === "a-two")).toMatchObject({ side: "left", color: 0, rating: 4, state: 9, collapsed: true });
    expect(map.nodes.find((node) => node.id === "a-root")?.side).toBe("right");
    expect(frontmatter(await fixture.read(map.path)).properties).not.toHaveProperty("emberly-side");
  });

  it("map settings rename only the map note and layout writes only its metadata", async () => {
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    const oldMapPath = map.path;
    const before = new Map(await Promise.all(fixture.index.sources().map(async (source) => [source.path, await fixture.read(source.path)] as const)));
    const rootIds = map.nodes.map((node) => [node.id, node.parentId, node.order]);
    await plugin.renameMap(map, "New map");
    expect(await fixture.read("New map/New map.emberly.md")).toBe(before.get(map.path));
    expect(fixture.index.file(map.path)).toBeUndefined();
    fixture.mutations.length = 0;
    await plugin.setMapLayout(map, "branch"); // stale path resolves by unchanged ID
    expect(fixture.mutations).toEqual(["write:New map/New map.emberly.md"]);
    const current = fixture.index.maps().find((map) => map.id === "a")!;
    expect(current).toMatchObject({ title: "New map", layout: "branch", issues: [] });
    expect(current.nodes.map((node) => [node.id, node.parentId, node.order])).toEqual(rootIds);
    expect(frontmatter(await fixture.read(current.path)).body).toBe(frontmatter(before.get(map.path)!).body);
    for (const [path, body] of before) if (path !== oldMapPath) {
      const currentPath = path.startsWith("a/") ? `New map${path.slice(1)}` : path;
      expect(await fixture.read(currentPath)).toBe(body);
    }
    fixture.mutations.length = 0; await plugin.setMapLayout(map, "branch"); expect(fixture.mutations).toEqual([]);
  });

  it("map settings reject invalid/occupied names and changes to deleted or changed map identity", async () => {
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    await fixture.addFolder("Occupied");
    await expect(plugin.renameMap(map, "Occupied")).rejects.toThrow("already uses");
    await expect(plugin.renameMap(map, "../escape")).rejects.toThrow();
    fixture.beforeProcess = async () => {
      await writeFile(fixture.path(map.path), note({ emberly: "map", "emberly-format": 2, "emberly-id": "changed", "emberly-root-id": "other" }));
    };
    await expect(plugin.setMapLayout(map, "branch")).rejects.toThrow("identity changed");
    fixture.index.remove(map.path);
    await expect(plugin.renameMap(map, "Gone")).rejects.toThrow("missing");
    expect(fixture.files.get("Occupied")).toBeDefined();
  });

  it("renames from the topic header through FileManager and rejects collisions, invalid names and stale edits", async () => {
    const file = fixture.index.file("a/Topics/one.md")!;
    const original = await fixture.read(file.path);
    const identity = { id: "a-one", mapId: "a" };
    const rename = vi.spyOn(fixture.app.fileManager, "renameFile");
    await expect(api.renameTopic(file, identity, "two", file.path)).rejects.toThrow("already");
    await expect(api.renameTopic(file, identity, "../bad", file.path)).rejects.toThrow("valid");
    await expect(api.renameTopic(file, identity, "", file.path)).rejects.toThrow("valid");
    await expect(api.renameTopic(file, { ...identity, id: "wrong" }, "Bad", file.path)).rejects.toThrow("missing");
    await api.renameTopic(file, identity, "Common Gull", file.path);
    expect(rename).toHaveBeenCalledOnce();
    expect(await fixture.read(file.path)).toBe(original);
    expect(fixture.index.maps().find((map) => map.id === "a")!.nodes.find((node) => node.id === "a-one"))
      .toMatchObject({ title: "Common Gull", path: "a/Topics/Common Gull.md" });
    await expect(api.renameTopic(file, identity, "Stale", "a/Topics/one.md")).rejects.toThrow("elsewhere");
    expect(rename).toHaveBeenCalledOnce();
  });

  it("renames in-map edits through FileManager without overwriting or synchronizing note headings", async () => {
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    const collection = new MarkdownNodeCollection(map, () => {});
    const entity = collection.getEntityById("a-one")!;
    const oldContent = await fixture.read(entity.sourcePath);
    const snapshot = { ...collection.snapshot(entity), name: "Renamed", changed: ["name"] };
    const rename = vi.spyOn(fixture.app.fileManager, "renameFile");
    await plugin.persistEngineEntity(map, snapshot);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await fixture.read("a/Topics/Renamed.md")).toBe(oldContent);
    expect(fixture.index.resourceCatalog().resources[0]).toMatchObject({ topicId: "a-one" });
    const current = fixture.index.maps().find((map) => map.id === "a")!;
    expect(current.issues).toEqual([]);
    expect(current.nodes.find((node) => node.id === "a-one")).toMatchObject({ title: "Renamed", path: "a/Topics/Renamed.md" });
    await expect(plugin.persistEngineEntity(map, { ...snapshot, name: "two" })).rejects.toThrow("already");
    await expect(plugin.persistEngineEntity(map, { ...snapshot, name: "../bad" })).rejects.toThrow("valid");
    expect(await fixture.read("a/Topics/Renamed.md")).toBe(oldContent);
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("reserves concurrent rename destinations and releases reservations after failures", async () => {
    const one = fixture.index.file("a/Topics/one.md")!, two = fixture.index.file("a/Topics/two.md")!;
    const results = await Promise.allSettled([api.renameNote(one, "Same"), api.renameNote(two, "Same")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    fixture.failRename = true;
    await expect(api.renameNote(two, "Other")).rejects.toThrow("interruption");
    fixture.failRename = false;
    await api.renameNote(two, "Other");
    expect(two.path).toBe("a/Topics/Other.md");
  });

  it("moves a branch by writing one topic only, preserving descendants, resources and map prose", async () => {
    let map = fixture.index.maps().find((map) => map.id === "a")!;
    const descendant = await api.createTopic(map, "Grandchild", "a-one");
    const destination = await api.createTopic(map, "Destination", "a-root");
    map = fixture.index.maps().find((map) => map.id === "a")!;
    const before = new Map(await Promise.all(fixture.index.sources().map(async (file) => [file.path, await fixture.read(file.path)] as const)));
    const collection = new MarkdownNodeCollection(map, () => {}), entity = collection.getEntityById("a-one")!;
    const destinationId = map.nodes.find((node) => node.path === destination.path)!.id;
    const snapshot = { ...collection.snapshot(entity), parentId: destinationId, previousParentId: "a-root", previousIndex: entity.index,
      previousSiblingId: null, nextSiblingId: null, changed: ["parentId", "index"] };
    fixture.mutations.length = 0;
    await plugin.persistEngineEntity(map, snapshot);
    expect(fixture.mutations).toEqual(["write:a/Topics/one.md"]);
    for (const [path, content] of before) if (path !== "a/Topics/one.md") expect(await fixture.read(path)).toBe(content);
    const after = fixture.index.maps().find((map) => map.id === "a")!;
    expect(after.issues).toEqual([]);
    expect(after.nodes.find((node) => node.id === "a-one")).toMatchObject({ parentId: destinationId, order: "a0" });
    expect(after.nodes.find((node) => node.path === descendant.path)?.parentId).toBe("a-one");
    expect(fixture.index.resourceCatalog().resources[0]?.topicId).toBe("a-one");
    entity.setParentId(destinationId, { sync: false }); entity.setIndex("a0", { sync: false });
    expect(collection.matchesStructure(after)).toBe(true);
  });

  it("persists rapid fractional reorders without touching siblings or the map", async () => {
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    const collection = new MarkdownNodeCollection(map, (snapshot) => plugin.persistEngineEntity(map, snapshot));
    const b = collection.getEntityById("a-two")!, a = collection.getEntityById("a-one")!;
    const mapBody = await fixture.read(map.path), sibling = await fixture.read(a.sourcePath);
    fixture.mutations.length = 0;
    b.placeBetween(undefined, a); b.placeBetween(a, undefined); b.placeBetween(undefined, a);
    await vi.waitFor(() => expect(fixture.mutations).toHaveLength(3));
    expect(fixture.mutations.every((mutation) => mutation === "write:a/Topics/two.md")).toBe(true);
    expect(frontmatter(await fixture.read(b.sourcePath)).properties["emberly-order"]).toBe("Zz");
    expect(await fixture.read(map.path)).toBe(mapBody); expect(await fixture.read(a.sourcePath)).toBe(sibling);
    expect(collection.matchesStructure(fixture.index.maps().find((map) => map.id === "a")!)).toBe(true);
  });

  it("does not overwrite a topic reordered between validation and the atomic source update", async () => {
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    const collection = new MarkdownNodeCollection(map, () => {}), b = collection.getEntityById("a-two")!;
    const snapshot = { ...collection.snapshot(b), index: "Zz", previousParentId: "a-one", previousIndex: b.index,
      previousSiblingId: null, nextSiblingId: null, changed: ["index"] };
    fixture.beforeProcess = async () => {
      const fm = frontmatter(await fixture.read(b.sourcePath)); fm.properties["emberly-order"] = "a5";
      await writeFile(fixture.path(b.sourcePath), note(fm.properties, fm.body));
    };
    await expect(plugin.persistEngineEntity(map, snapshot)).rejects.toThrow("outside this view");
    expect(frontmatter(await fixture.read(b.sourcePath)).properties["emberly-order"]).toBe("a5");
  });

  it("rechecks destination ancestors from disk when cached metadata is stale", async () => {
    const map = fixture.index.maps().find((map) => map.id === "a")!;
    const collection = new MarkdownNodeCollection(map, () => {}), a = collection.getEntityById("a-one")!;
    const bFile = fixture.index.file("a/Topics/two.md")!, original = await fixture.read(bFile.path);
    fixture.index.setContent(bFile.path, original);
    const doc = frontmatter(original); doc.properties["emberly-parent"] = "a-one";
    await writeFile(fixture.path(bFile.path), note(doc.properties, doc.body));
    const snapshot = { ...collection.snapshot(a), parentId: "a-two", previousParentId: "a-root",
      previousSiblingId: null, nextSiblingId: null, changed: ["parentId"] };
    const before = await fixture.read(a.sourcePath);
    await expect(plugin.persistEngineEntity(map, snapshot)).rejects.toThrow("own branch");
    expect(await fixture.read(a.sourcePath)).toBe(before);
  });
});
