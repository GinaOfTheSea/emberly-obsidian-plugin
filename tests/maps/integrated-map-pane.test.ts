// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile, type App, type PluginManifest, type WorkspaceLeaf, type CachedMetadata, type ViewState } from "obsidian";
import EmberlyMapsPlugin from "../../src/main";
import type { EmberlyVaultIndex } from "../../src/vault/vault-index";
import type { EmberlyMap, EmberlyNode } from "../../src/shared/types";
import type { IntegratedMapPane } from "../../src/maps/integrated-map-pane";
import { installObsidianDom } from "../helpers/obsidian-dom";
import { EmberlyMapView } from "../../src/maps/map-view";
import type { ResourceMoveSession } from "../../src/topics/topic-note-pane";

const engineState = vi.hoisted(() => ({ instances: [] as {
  destroy: ReturnType<typeof vi.fn>; applyAppearance: ReturnType<typeof vi.fn>;
  reconcileIdentity: ReturnType<typeof vi.fn>;
  references: { source: string; targets: string[] } | null;
  fit: ReturnType<typeof vi.fn>;
}[] }));
vi.mock("../../src/emberly-engine/engine-host", () => ({ EmberlyEngineHost: class {
  destroy = vi.fn(); applyAppearance = vi.fn(); setTopicDragging = vi.fn(); fit = vi.fn(); resize = vi.fn();
  applyMapCenter = vi.fn();
  reconcileIdentity = vi.fn();
  matchesStructure = vi.fn(() => false);
  references: { source: string; targets: string[] } | null = null;
  showReferenceLinks(source: string, targets: string[]) { this.references = { source, targets }; }
  clearReferenceLinks() { this.references = null; }
  constructor(container: HTMLElement) { container.createEl("canvas"); engineState.instances.push(this); }
  nodeCount() { return 2; } collapseState() { return null; }
} }));
vi.mock("../../src/ui/modals", () => ({ MapPickerModal: class {}, NameModal: class {} }));
vi.mock("../../src/emberly-engine/renderer-assets", () => ({ loadEmberlyFonts: vi.fn(), unloadEmberlyFonts: vi.fn() }));
// Header/resource actions already have their own tests. Keep this suite focused
// on host layout, native navigation, queue cancellation and renderer lifetime.
vi.mock("../../src/topics/topic-note-pane", () => ({ TopicNotePane: class {
  element: HTMLElement;
  constructor(public view: MarkdownView) { this.element = view.contentEl.createDiv({ cls: "emberly-topic-chrome" }); }
  update() {} updatePresentation() {} showFile = vi.fn();
  dispose() { this.element.remove(); }
} }));
vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<object>();
  class ItemView {
    containerEl = document.body.createDiv();
    contentEl = this.containerEl.createDiv({ cls: "view-content" });
    constructor(public leaf: WorkspaceLeaf) {}
    async setState() {}
  }
  return { ...original, ItemView,
    MarkdownView: class extends ItemView {
      file: TFile | null = null;
      editor = { focus: vi.fn() };
      save = vi.fn(async () => {});
      getMode() { return "source"; }
    },
    Plugin: class {
      constructor(public app: App) {}
      async loadData() { return {}; }
      registerView() {} addRibbonIcon() {} addCommand() {} registerDomEvent() {} registerEvent() {}
    },
    normalizePath: (path: string) => path,
  };
});

type Internals = {
  topicPanes: Map<WorkspaceLeaf, { showFile: ReturnType<typeof vi.fn> }>;
  syncTopicPanes(): void;
  integratedPanes: Map<WorkspaceLeaf, IntegratedMapPane>;
  topicOpenRequests: Map<WorkspaceLeaf, symbol>;
  refreshReferenceIndex(): void;
  scheduleReferences(path?: string): void;
  invalidateReferences(): void;
  updateMoveViews(): void;
  moveSession?: ResourceMoveSession;
};

function fixture() {
  const events = () => {
    const callbacks = new Map<string, (...args: any[]) => void>();
    return { on: (name: string, callback: (...args: any[]) => void) => callbacks.set(name, callback),
      emit: (name: string, ...args: any[]) => callbacks.get(name)?.(...args) };
  };
  const metadataEvents = events(), vaultEvents = events(), workspaceEvents = events();
  const file = (path: string) => Object.assign(new TFile(), { path });
  const root = file("a/Topics/root.md"), topic = file("a/Topics/second.md"), third = file("a/Topics/third.md"), resource = file("a/Resources/file.md"), unrelated = file("Other.md");
  const mapFile = file("a/Map.md");
  const files = [root, topic, third, resource, unrelated, mapFile];
  const ids = new Map(files.map((file) => [file, file.path]));
  const node = (file: TFile, parentId: string | null): EmberlyNode => ({ id: file.path, path: file.path, title: file.path, mapId: "a", parentId, order: 1, side: "right", color: -1, collapsed: false, rating: 0, state: 0 });
  const map: EmberlyMap = { id: "a", format: 2, path: "a/Map.md", folder: "a", title: "A", layout: "center", issues: [], nodes: [node(root, null), node(topic, root.path), node(third, root.path)] };
  const leaves: WorkspaceLeaf[] = [];
  const pluginRef = {} as { current: EmberlyMapsPlugin };
  const sync = () => (pluginRef.current as unknown as Internals).syncTopicPanes();
  const workspace = {
    on: workspaceEvents.on,
    onLayoutReady: (callback: () => void) => callback(),
    getLeaf: vi.fn(() => {
      const leaf = {} as WorkspaceLeaf;
      leaf.view = new MarkdownView(leaf);
      // A native editable element with a cursor/draft we must never replace.
      (leaf.view as MarkdownView).contentEl.createDiv({ cls: "markdown-source-view", text: "unsaved native draft" });
      leaf.openFile = vi.fn(async (file: TFile) => { (leaf.view as MarkdownView).file = file; sync(); });
      leaf.setViewState = vi.fn(async (state: ViewState) => {
        leaf.view = new EmberlyMapView(leaf, plugin);
        await leaf.view.setState(state.state ?? {}, { history: false });
        await (leaf.view as unknown as { onOpen(): Promise<void> }).onOpen();
      });
      leaves.push(leaf);
      return leaf;
    }),
    createLeafBySplit: vi.fn(() => workspace.getLeaf()),
    iterateAllLeaves: (visit: (leaf: WorkspaceLeaf) => void) => leaves.forEach(visit),
    getLeavesOfType: () => leaves.filter((leaf) => leaf.view instanceof EmberlyMapView),
    revealLeaf: vi.fn(async () => {}),
    setActiveLeaf: vi.fn(),
    detachLeavesOfType: vi.fn(),
  };
  const propertiesFor = (file: TFile) => file === unrelated ? {} : file === mapFile ? { emberly: "map", "emberly-format": 2, "emberly-id": "a" } : {
    emberly: file === resource ? "resource" : "topic", "emberly-map": "a",
    "emberly-format": file === resource ? 2 : 1, "emberly-id": ids.get(file),
  };
  const links = new Map<string, string[]>([[root.path, [topic.path]], [resource.path, [third.path]]]);
  const resources = [{ path: resource.path, mapId: "a", topicId: topic.path }];
  const resolutionBlocked = new Set<string>();
  const app = { workspace, vault: { on: vaultEvents.on }, metadataCache: {
    on: metadataEvents.on,
    getFileCache: (file: TFile) => ({ frontmatter: propertiesFor(file), links: (links.get(file.path) ?? []).map((link) => ({ link })) } as CachedMetadata),
    getFirstLinkpathDest: (link: string) => resolutionBlocked.has(link) ? null : files.find((file) => file.path === link) ?? null,
  } } as unknown as App;
  const plugin = new EmberlyMapsPlugin(app, {} as PluginManifest);
  pluginRef.current = plugin;
  plugin.index = {
    withSnapshot: <T>(action: () => T): T => action(),
    // This layout-only adapter has no authoritative on-disk hierarchy to repair.
    hierarchySettled: () => false,
    file: (path: string) => files.find((file) => file.path === path),
    isMapAsset: () => false,
    maps: () => [structuredClone(map)], mapByPath: () => structuredClone(map), propertiesFor,
    resourceCatalog: () => ({ resources, issues: [] }),
    sources: () => files.map((file) => ({ path: file.path, basename: file.basename, frontmatter: propertiesFor(file), content: "# Notes\n" })),
    initialize: async () => false,
    setContent: vi.fn(), metadataObserved: vi.fn(), metadataPending: vi.fn(), rename: vi.fn(), remove: vi.fn(),
  } as unknown as EmberlyVaultIndex;
  (plugin as unknown as Internals).refreshReferenceIndex();
  return { plugin, workspace, leaves, map, mapFile, root, topic, third, resource, unrelated, links, resources, files,
    metadataEvents, vaultEvents, resolutionBlocked, app, sync, internal: plugin as unknown as Internals };
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("integrated native pane (DOM and public API adapter, not live Obsidian)", () => {
  let state: ReturnType<typeof fixture>;
  beforeEach(() => { installObsidianDom(); engineState.instances = []; state = fixture(); });
  afterEach(() => { state.plugin.onunload(); document.body.empty(); vi.restoreAllMocks(); });

  it.each([false, true])("opens settings on the existing root inspector without rebuilding canvas (separate=%s)", async (separate) => {
    await state.plugin.openMap(state.map, separate); await frame();
    const mapLeaf = state.leaves[0]!;
    await state.plugin.openTopicFile(state.topic.path, mapLeaf, false); await frame();
    const noteLeaf = state.leaves.at(-1)!, noteView = noteLeaf.view as MarkdownView;
    const surface = separate ? (mapLeaf.view as EmberlyMapView).surface : state.internal.integratedPanes.get(mapLeaf)!.surface;
    const canvas = surface.contentEl.querySelector("canvas"), editor = noteView.contentEl.querySelector(".markdown-source-view");
    await state.plugin.openMapSettings(state.map, mapLeaf);
    expect(state.leaves).toHaveLength(separate ? 2 : 1);
    expect(noteView.file).toBe(state.root);
    expect(state.internal.topicPanes.get(noteLeaf)!.showFile).toHaveBeenLastCalledWith({ section: "settings" });
    expect(surface.contentEl.querySelector("canvas")).toBe(canvas);
    expect(noteView.contentEl.querySelector(".markdown-source-view")).toBe(editor);
    await Promise.all([state.plugin.openMapSettings(state.map, mapLeaf), state.plugin.openTopicFile(state.topic.path, mapLeaf, false)]);
    expect(noteView.file).toBe(state.topic);
    expect(engineState.instances).toHaveLength(1);
    state.map.issues = ["Missing parent"];
    await expect(state.plugin.openMapSettings(state.map, mapLeaf)).rejects.toThrow("hierarchy issues");
    expect(noteView.file).toBe(state.topic);
  });

  it.each([false, true].flatMap((separate) => ["map", "topic", "root", "resource", "folder"].map((kind) => ({ separate, kind }))))(
    "reconciles $kind rename in separate=$separate layout without replacing canvas/editor or fitting", async ({ separate, kind }) => {
      await state.plugin.onload();
      await new Promise((resolve) => setTimeout(resolve, 180));
      await state.plugin.openMap(state.map, separate); await frame();
      const mapLeaf = state.leaves[0]!;
      await state.plugin.openTopicFile(kind === "resource" ? state.resource.path : state.topic.path, mapLeaf, false);
      await frame();
      if (separate) await new Promise((resolve) => setTimeout(resolve, 180)); // initial adjacent-pane fit, before rename
      const pane = state.internal.integratedPanes.get(mapLeaf);
      const surface = separate ? (mapLeaf.view as EmberlyMapView).surface : pane!.surface;
      const canvas = surface.contentEl.querySelector("canvas");
      const noteView = state.leaves.at(-1)!.view as MarkdownView;
      const editor = noteView.contentEl.querySelector(".markdown-source-view");
      const selected = noteView.file;
      const ids = state.map.nodes.map((node) => [node.id, node.parentId]);
      const engine = engineState.instances[0]!;
      const fitsBeforeRename = engine.fit.mock.calls.length;
      const file = kind === "map" ? state.mapFile : kind === "root" ? state.root : kind === "resource" ? state.resource : state.topic;
      const oldPath = kind === "folder" ? "a" : file.path;
      const newPath = kind === "folder" ? "New folder" : oldPath.replace(/[^/]+$/, "Renamed.pdf.md");
      const translate = (path: string) => path === oldPath || path.startsWith(oldPath + "/") ? newPath + path.slice(oldPath.length) : path;
      for (const file of state.files) file.path = translate(file.path);
      state.map.path = translate(state.map.path);
      state.map.folder = state.map.path.split("/").slice(0, -1).join("/");
      state.map.title = state.mapFile.basename;
      state.map.nodes = state.map.nodes.map((node) => ({ ...node, path: translate(node.path), title: translate(node.path).split("/").at(-1)!.slice(0, -3) }));
      for (const resource of state.resources) resource.path = translate(resource.path);
      for (const [path, targets] of [...state.links]) { state.links.delete(path); state.links.set(translate(path), targets.map(translate)); }
      state.vaultEvents.emit("rename", kind === "folder" ? { path: newPath } : file, oldPath);
      await new Promise((resolve) => setTimeout(resolve, 190));
      state.metadataEvents.emit("changed", file, "# Native saved body\n", state.app.metadataCache.getFileCache(file));
      await new Promise((resolve) => setTimeout(resolve, 190));
      expect(surface.mapPath).toBe(state.map.path);
      expect(surface.contentEl.querySelector(".emberly-map-name")?.textContent).toBe(state.mapFile.basename);
      expect(surface.contentEl.querySelector("canvas")).toBe(canvas);
      expect(noteView.file).toBe(selected);
      expect(noteView.contentEl.querySelector(".markdown-source-view")).toBe(editor);
      expect(state.map.nodes.map((node) => [node.id, node.parentId])).toEqual(ids);
      expect(engineState.instances).toHaveLength(1);
      expect(engine.destroy).not.toHaveBeenCalled(); expect(engine.fit).toHaveBeenCalledTimes(fitsBeforeRename);
      for (const node of state.map.nodes) expect(engine.reconcileIdentity).toHaveBeenCalledWith(expect.objectContaining({ id: node.id, path: node.path, title: node.title }));
      expect(engine.references?.source).toBe(ids[1]![0]);
      if (kind === "map" || kind === "folder") {
        const choose = vi.spyOn(state.plugin, "chooseMap").mockImplementation(() => {});
        surface.contentEl.querySelector<HTMLButtonElement>('[aria-label="Choose map"]')!.click();
        expect(choose).toHaveBeenCalledWith(separate);
      }
    });

  it("opens one native pane, leaves editor DOM in place, and reuses the canvas across topic/resource clicks", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, view = leaf.view as MarkdownView;
    const editor = view.contentEl.querySelector(".markdown-source-view");
    const canvas = view.contentEl.querySelector("canvas");
    await state.plugin.openTopicFile(state.topic.path, leaf, false);
    await state.plugin.openTopicFile(state.resource.path, leaf, true);
    state.sync(); state.sync(); await frame(); // metadata/layout updates, including autosaves
    expect(state.leaves).toHaveLength(1);
    expect(state.workspace.createLeafBySplit).not.toHaveBeenCalled();
    expect(view.file).toBe(state.resource);
    expect(editor?.parentElement).toBe(view.contentEl);
    expect(editor?.textContent).toBe("unsaved native draft");
    expect(view.contentEl.querySelector("canvas")).toBe(canvas);
    expect(engineState.instances).toHaveLength(1);
    expect(engineState.instances[0]!.destroy).not.toHaveBeenCalled();
    expect(view.editor.focus).toHaveBeenCalled();
  });

  it("does not reopen the same note, and focuses the map for single-click navigation", async () => {
    await state.plugin.openMap(state.map);
    const leaf = state.leaves[0]!, view = leaf.view as MarkdownView;
    const opens = vi.mocked(leaf.openFile).mock.calls.length;
    await state.plugin.openTopicFile(state.root.path, leaf, false);
    expect(leaf.openFile).toHaveBeenCalledTimes(opens);
    expect(document.activeElement).toBe(view.contentEl.querySelector(".emberly-integrated-map"));
    expect(view.editor.focus).not.toHaveBeenCalled();
  });

  it("collapses/reveals and resizes the inspector without rebuilding the map", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, view = leaf.view as MarkdownView;
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Hide notes and resources"]')!.click();
    expect(view.containerEl.classList.contains("emberly-integrated-collapsed")).toBe(true);
    await state.plugin.openTopicFile(state.topic.path, leaf, false);
    expect(view.containerEl.classList.contains("emberly-integrated-collapsed")).toBe(false);
    Object.defineProperty(view.contentEl, "clientWidth", { value: 1200 });
    view.contentEl.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(view.contentEl.style.getPropertyValue("--emberly-inspector-width")).toBe("404px");
    expect(engineState.instances).toHaveLength(1);
  });

  it("restores only our containers after a native file/mode transition", async () => {
    await state.plugin.openMap(state.map); await frame();
    const view = state.leaves[0]!.view as MarkdownView;
    const host = view.contentEl.querySelector(".emberly-integrated-map")!;
    const editor = view.contentEl.querySelector(".markdown-source-view")!;
    host.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.parentElement).toBe(view.contentEl);
    expect(editor.parentElement).toBe(view.contentEl);
    expect(engineState.instances).toHaveLength(1);
  });

  it("returns to an untouched plain note on exit and cleans up the renderer exactly once", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, view = leaf.view as MarkdownView;
    const editor = view.contentEl.querySelector(".markdown-source-view");
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Return to plain note"]')!.click();
    state.plugin.closeIntegratedMap(leaf);
    expect(view.contentEl.children).toHaveLength(1);
    expect(editor?.parentElement).toBe(view.contentEl);
    expect(view.containerEl.className).not.toContain("emberly");
    expect(state.internal.integratedPanes.size).toBe(0);
    expect(engineState.instances[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(view.file).toBe(state.root);
  });

  it("native navigation to an unrelated note exits; history/links within the map do not", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!;
    await leaf.openFile(state.topic);
    expect(state.internal.integratedPanes.size).toBe(1);
    await leaf.openFile(state.unrelated);
    expect(state.internal.integratedPanes.size).toBe(0);
    expect((leaf.view as MarkdownView).file).toBe(state.unrelated);
    expect(engineState.instances[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it("cancels queued map navigation when the user leaves the layout", async () => {
    await state.plugin.openMap(state.map);
    const leaf = state.leaves[0]!;
    const pending = state.plugin.openTopicFile(state.topic.path, leaf);
    state.plugin.closeIntegratedMap(leaf);
    await pending;
    expect((leaf.view as MarkdownView).file).toBe(state.root);
    expect(state.workspace.createLeafBySplit).not.toHaveBeenCalled();
  });

  it("latest map click wins without allocating another pane", async () => {
    await state.plugin.openMap(state.map);
    const leaf = state.leaves[0]!;
    await Promise.all([state.plugin.openTopicFile(state.topic.path, leaf), state.plugin.openTopicFile(state.resource.path, leaf)]);
    expect((leaf.view as MarkdownView).file).toBe(state.resource);
    expect(state.leaves).toHaveLength(1);
  });

  it("keeps the map through the native editor's temporary no-file state during a file switch", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, view = leaf.view as MarkdownView;
    leaf.openFile = vi.fn(async (file: TFile) => {
      view.file = null; state.sync();
      await Promise.resolve();
      view.file = file; state.sync();
    });
    await state.plugin.openTopicFile(state.topic.path, leaf, true);
    expect(state.internal.integratedPanes.size).toBe(1);
    expect(view.file).toBe(state.topic);
    expect(view.editor.focus).toHaveBeenCalled();
    expect(engineState.instances).toHaveLength(1);
    expect(engineState.instances[0]!.destroy).not.toHaveBeenCalled();
  });

  it("leaves the canvas mounted if the same resource is renamed/moved", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!;
    await state.plugin.openTopicFile(state.resource.path, leaf);
    state.resource.path = "b/Resources/file.md";
    state.sync();
    expect(state.internal.integratedPanes.size).toBe(1);
    await state.plugin.openTopicFile(state.root.path, leaf, false, { section: "resources" });
    expect((leaf.view as MarkdownView).file).toBe(state.root);
    expect(engineState.instances).toHaveLength(1);
  });

  it("cleans up when the native workspace replaces or closes the leaf", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, oldView = leaf.view as MarkdownView;
    leaf.view = new MarkdownView(leaf);
    state.sync();
    expect(state.internal.integratedPanes.size).toBe(0);
    expect(oldView.contentEl.querySelector(".emberly-integrated-map")).toBeNull();
    expect(engineState.instances[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not start a late renderer after the integrated pane has closed", async () => {
    await state.plugin.openMap(state.map);
    state.plugin.closeIntegratedMap(state.leaves[0]!);
    await frame();
    expect(engineState.instances).toHaveLength(0);
  });

  it("unloading the plugin preserves the open native note and its draft", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, view = leaf.view as MarkdownView;
    state.plugin.onunload();
    expect(view.file).toBe(state.root);
    expect(view.contentEl.textContent).toBe("unsaved native draft");
    expect(state.leaves).toHaveLength(1);
    expect(engineState.instances[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it("follows topic/resource selection and native history without recreating canvas or fitting", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, view = leaf.view as MarkdownView, engine = engineState.instances[0]!;
    const canvas = view.contentEl.querySelector("canvas");
    expect(engine.references).toEqual({ source: state.root.path, targets: [state.topic.path] });
    await state.plugin.openTopicFile(state.resource.path, leaf);
    expect(engine.references).toEqual({ source: state.topic.path, targets: [state.third.path] });
    await leaf.openFile(state.topic); // Native history: topic links, not its resources' links.
    expect(engine.references).toEqual({ source: state.topic.path, targets: [] });
    await leaf.openFile(state.third);
    expect(engine.references).toEqual({ source: state.third.path, targets: [state.topic.path] });
    expect(view.contentEl.querySelector("canvas")).toBe(canvas);
    expect(engine.fit).not.toHaveBeenCalled();
    expect(engineState.instances).toHaveLength(1);
  });

  it("coalesces cache updates and applies edited links to the current note, not a stale selection", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, engine = engineState.instances[0]!;
    const rebuild = vi.spyOn(state.internal, "refreshReferenceIndex");
    state.links.set(state.topic.path, [state.third.path]);
    state.internal.scheduleReferences(state.topic.path);
    state.internal.scheduleReferences(state.topic.path);
    await state.plugin.openTopicFile(state.third.path, leaf);
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(engine.references).toEqual({ source: state.third.path, targets: [state.topic.path] });
    state.links.delete(state.resource.path); state.links.delete(state.topic.path);
    state.internal.scheduleReferences(state.topic.path); state.internal.scheduleReferences(state.resource.path);
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(engine.references).toEqual({ source: state.third.path, targets: [] });
    expect(engineState.instances).toHaveLength(1);
    expect(engine.fit).not.toHaveBeenCalled();
  });

  it("clears references in resource-move mode and restores the current note on cancel", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, engine = engineState.instances[0]!;
    await state.plugin.openTopicFile(state.resource.path, leaf);
    state.internal.moveSession = {} as ResourceMoveSession; state.internal.updateMoveViews();
    expect(engine.references).toBeNull();
    await leaf.openFile(state.third);
    expect(engine.references).toBeNull();
    state.internal.moveSession = undefined; state.internal.updateMoveViews();
    expect(engine.references).toEqual({ source: state.third.path, targets: [state.topic.path] });
  });

  it("clears invalid ownership immediately and reprojects a resource when its owner changes", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, engine = engineState.instances[0]!;
    await state.plugin.openTopicFile(state.resource.path, leaf);
    state.resources.length = 0; state.internal.invalidateReferences();
    expect(engine.references).toBeNull();
    state.internal.refreshReferenceIndex();
    expect(engine.references).toBeNull();
    state.resources.push({ path: state.resource.path, mapId: "a", topicId: state.third.path });
    state.internal.refreshReferenceIndex();
    expect(engine.references).toEqual({ source: state.third.path, targets: [] });
    expect(engineState.instances).toHaveLength(1);
  });

  it("keeps separate and integrated surfaces tied to their own associated note panes", async () => {
    await state.plugin.openMap(state.map); await frame();
    const integrated = state.leaves[0]!;
    await state.plugin.openMap(state.map, true); await frame();
    const separate = state.leaves[1]!;
    await state.plugin.openTopicFile(state.resource.path, separate);
    const note = state.leaves[2]!;
    expect(engineState.instances[0]!.references).toEqual({ source: state.root.path, targets: [state.topic.path] });
    expect(engineState.instances[1]!.references).toEqual({ source: state.topic.path, targets: [state.third.path] });
    await note.openFile(state.third); // Native history in the separate note leaf.
    expect(engineState.instances[1]!.references).toEqual({ source: state.third.path, targets: [state.topic.path] });
    await state.plugin.openTopicFile(state.topic.path, integrated);
    expect(engineState.instances[0]!.references).toEqual({ source: state.topic.path, targets: [] });
    expect(engineState.instances[1]!.references?.source).toBe(state.third.path);
    await note.openFile(state.unrelated);
    expect(engineState.instances[1]!.references).toBeNull();
    expect(engineState.instances[0]!.references?.source).toBe(state.topic.path);
    expect(engineState.instances).toHaveLength(2);
  });

  it("cancels stale queued map clicks when native history changes a separate note pane", async () => {
    await state.plugin.openMap(state.map, true); await frame();
    const map = state.leaves[0]!;
    await state.plugin.openTopicFile(state.resource.path, map);
    const note = state.leaves[1]!;
    const pending = state.plugin.openTopicFile(state.topic.path, map);
    expect(engineState.instances[0]!.references).toBeNull();
    await note.openFile(state.third); await pending;
    expect((note.view as MarkdownView).file).toBe(state.third);
    expect(engineState.instances[0]!.references).toEqual({ source: state.third.path, targets: [state.topic.path] });
  });

  it("recognizes its own separate-pane open even when the inactive leaf emits no file-open event", async () => {
    await state.plugin.openMap(state.map, true); await frame();
    const map = state.leaves[0]!;
    await state.plugin.openTopicFile(state.resource.path, map);
    const note = state.leaves[1]!;
    note.openFile = vi.fn(async (file) => { (note.view as MarkdownView).file = file; });
    state.workspace.setActiveLeaf.mockClear();
    await state.plugin.openTopicFile(state.third.path, map);
    expect(state.workspace.setActiveLeaf).toHaveBeenCalledWith(note, { focus: true });
    expect(engineState.instances[0]!.references).toEqual({ source: state.third.path, targets: [state.topic.path] });
  });

  it("listens to real plugin metadata hooks for body edits without rebuilding the map", async () => {
    await state.plugin.onload(); await new Promise((resolve) => setTimeout(resolve, 180));
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!, engine = engineState.instances[0]!;
    await state.plugin.openTopicFile(state.topic.path, leaf);
    state.links.set(state.topic.path, [state.third.path]);
    const cache = state.app.metadataCache.getFileCache(state.topic)!;
    const data = `---\n${JSON.stringify(cache.frontmatter)}\n---\n# Notes\n[[${state.third.path}]]`;
    state.metadataEvents.emit("changed", state.topic, data, cache);
    state.metadataEvents.emit("resolve", state.topic);
    state.metadataEvents.emit("resolved");
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(engine.references).toEqual({ source: state.topic.path, targets: [state.third.path] });
    expect(engineState.instances).toHaveLength(1);
    expect(engine.destroy).not.toHaveBeenCalled();
    expect(engine.fit).not.toHaveBeenCalled();
  });

  it("retries unresolved sources after the target finishes resolving, without another source event", async () => {
    state.resolutionBlocked.add(state.third.path);
    await state.plugin.onload();
    state.metadataEvents.emit("resolve", state.resource);
    await new Promise((resolve) => setTimeout(resolve, 180));
    await state.plugin.openMap(state.map); await frame();
    await state.plugin.openTopicFile(state.resource.path, state.leaves[0]!);
    expect(engineState.instances[0]!.references?.targets).toEqual([]);
    state.resolutionBlocked.clear();
    state.metadataEvents.emit("resolve", state.third);
    state.metadataEvents.emit("resolved");
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(engineState.instances[0]!.references).toEqual({ source: state.topic.path, targets: [state.third.path] });
  });

  it("reindexes rename/delete events without leaving reverse edges behind", async () => {
    await state.plugin.onload(); await new Promise((resolve) => setTimeout(resolve, 180));
    await state.plugin.openMap(state.map); await frame();
    await state.plugin.openTopicFile(state.third.path, state.leaves[0]!);
    const engine = engineState.instances[0]!, old = state.resource.path;
    state.resource.path = "a/Resources/Renamed.md";
    state.resources[0]!.path = state.resource.path;
    state.links.delete(old); state.links.set(state.resource.path, [state.third.path]);
    state.vaultEvents.emit("rename", state.resource, old);
    expect(engine.references).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(engine.references?.targets).toEqual([state.topic.path]);
    state.files.splice(state.files.indexOf(state.resource), 1); state.resources.length = 0;
    state.vaultEvents.emit("delete", state.resource);
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(engine.references?.targets).toEqual([]);
    expect(engineState.instances).toHaveLength(1);
  });

  it("reapplies after explicit renderer recreation and prevents late work after close/unload", async () => {
    await state.plugin.openMap(state.map); await frame();
    const leaf = state.leaves[0]!;
    await state.plugin.openTopicFile(state.resource.path, leaf);
    state.internal.integratedPanes.get(leaf)!.surface.refresh(); await frame();
    expect(engineState.instances).toHaveLength(2);
    expect(engineState.instances[1]!.references).toEqual({ source: state.topic.path, targets: [state.third.path] });
    state.internal.scheduleReferences(state.resource.path);
    state.plugin.closeIntegratedMap(leaf);
    const refresh = vi.spyOn(state.internal, "refreshReferenceIndex");
    state.plugin.onunload();
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(refresh).not.toHaveBeenCalled();
    expect(engineState.instances[1]!.destroy).toHaveBeenCalledTimes(1);
  });
});
