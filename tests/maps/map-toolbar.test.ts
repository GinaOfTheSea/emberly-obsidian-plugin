// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import type EmberlyMapsPlugin from "../../src/main";
import { EmberlyMapSurface } from "../../src/maps/map-surface";
import type { EmberlyMap } from "../../src/shared/types";
import { installObsidianDom } from "../helpers/obsidian-dom";

const state = vi.hoisted(() => ({ engines: [] as any[] }));
vi.mock("../../src/emberly-engine/engine-host", () => ({ EmberlyEngineHost: class {
  fit = vi.fn(); resize = vi.fn(); zoom = vi.fn(); destroy = vi.fn();
  applyMapCenter = vi.fn();
  setTopicDragging = vi.fn(); clearReferenceLinks = vi.fn(); showReferenceLinks = vi.fn(); reconcileIdentity = vi.fn();
  collapsed = false;
  constructor(container: HTMLElement, _map: EmberlyMap, public callbacks: { focus(id: string): void }) {
    container.createEl("canvas"); state.engines.push(this);
  }
  nodeCount() { return 2; }
  collapseState(id: string) { return id === "root" ? { collapsed: this.collapsed } : null; }
  toggleCollapse() { return this.collapsed = !this.collapsed; }
  entityPath(id: string) { return `Map/${id}.md`; }
} }));
describe("Emberly-style map button groups (isolated DOM, not visual QA)", () => {
  let root: HTMLElement, surface: EmberlyMapSurface, plugin: any, map: EmberlyMap;
  const button = (label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const start = async (integrated = false) => {
    surface = new EmberlyMapSurface(root, {} as WorkspaceLeaf, plugin as EmberlyMapsPlugin, map.path,
      integrated ? (group) => { group.createEl("button", { attr: { "aria-label": "Hide notes and resources", type: "button" } }); } : undefined);
    surface.refresh(); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  };
  beforeEach(() => {
    installObsidianDom(); state.engines.length = 0;
    root = document.body.createDiv();
    map = { id: "map", path: "Map/Map.md", folder: "Map", title: "My map", layout: "center", format: 2, issues: [], nodes: [
      { id: "root", path: "Map/root.md", title: "root", mapId: "map", parentId: null, order: "a0", side: "center", color: -1, collapsed: false, rating: 0, state: 0 },
    ] };
    plugin = { index: { mapByPath: () => map, maps: () => [map] }, resourceMoveActive: false,
      chooseMap: vi.fn(), openFile: vi.fn(), promptForTopic: vi.fn(), openMapSettings: vi.fn(async () => {}),
      syncReferenceViews: vi.fn(), selectResourceMoveTarget: () => false, openTopicFile: vi.fn(async () => {}) };
  });
  afterEach(() => { surface?.dispose(); document.body.replaceChildren(); });

  it.each([false, true])("keeps map switching in its current layout (integrated=%s)", async (integrated) => {
    await start(integrated);
    button("Choose map").click(); expect(plugin.chooseMap).toHaveBeenCalledWith(!integrated);
    expect(button("Choose map").textContent).toContain("My map");
    expect(button("Open map note")).toBeNull();
    expect(root.querySelectorAll(".emberly-map-navigation button")).toHaveLength(1);
    expect(root.querySelectorAll('[aria-label="Notes panel controls"]').length).toBe(integrated ? 1 : 0);
  });
  it.each([false, true])("separates exactly three centered topic actions from side controls (integrated=%s)", async (integrated) => {
    await start(integrated);
    const group = root.querySelector(".emberly-topic-actions")!;
    expect(group.parentElement).toBe(root.querySelector(".emberly-toolbar"));
    expect(Array.from(group.querySelectorAll("button"), (button) => button.getAttribute("aria-label")))
      .toEqual(["Add sibling topic", "Add child topic", "Select a branch topic to collapse"]);
    expect(button("Map settings").closest(".emberly-toolbar-actions")).not.toBeNull();
    expect(button("Reload from Markdown").closest(".emberly-toolbar-actions")).not.toBeNull();
    expect(group.contains(button("Choose map"))).toBe(false);
  });
  it("connects existing map/edit/viewport actions without recreating the canvas", async () => {
    await start(); const engine = state.engines[0], canvas = root.querySelector("canvas");
    button("Add child topic").click(); expect(plugin.promptForTopic).toHaveBeenCalledWith(map, null);
    button("Map settings").click(); expect(plugin.openMapSettings).toHaveBeenCalledWith(map, surface.leaf);
    button("Zoom out").click(); button("Zoom in").click(); button("Fit map").click();
    expect(engine.zoom.mock.calls).toEqual([[-1], [1]]); expect(engine.fit).toHaveBeenCalledOnce();
    expect(engine.resize).toHaveBeenCalledOnce(); expect(root.querySelector("canvas")).toBe(canvas);
    expect(button("Fit map").closest('[aria-label="Map zoom"]')).not.toBeNull();
    expect(root.querySelector(".emberly-toolbar")!.contains(button("Fit map"))).toBe(false);
  });
  it("maintains selection, disabled states and collapse feedback", async () => {
    await start(); expect(button("Select a branch topic to collapse").disabled).toBe(true);
    state.engines[0].callbacks.focus("root");
    button("Add child topic").click(); expect(plugin.promptForTopic).toHaveBeenLastCalledWith(map, "root");
    button("Collapse selected topic").click();
    expect(button("Expand selected topic").querySelector("path")?.getAttribute("d")).toBe("M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z");
    expect(button("Expand selected topic").getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Topic collapsed");
    button("Expand selected topic").click(); expect(button("Collapse selected topic").getAttribute("aria-pressed")).toBe("false");
    expect(button("Collapse selected topic").querySelector("path")?.getAttribute("d")).toBe("m12 8-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z");
  });
  it.each([false, true])("routes root clicks to settings and child clicks to notes (integrated=%s)", async (integrated) => {
    map.nodes.push({ ...map.nodes[0]!, id: "child", parentId: "root", path: "Map/child.md", side: "right" });
    await start(integrated); const canvas = root.querySelector("canvas");
    state.engines[0].callbacks.focus("root");
    expect(plugin.openMapSettings).toHaveBeenCalledWith(map, surface.leaf);
    expect(plugin.openTopicFile).not.toHaveBeenCalled();
    state.engines[0].callbacks.focus("child");
    expect(plugin.openTopicFile).toHaveBeenCalledWith("Map/child.md", surface.leaf, false);
    expect(button("Map settings").querySelector("path")?.getAttribute("d")).toContain("M3 17v2h6v-2H3z");
    plugin.resourceMoveActive = true; plugin.selectResourceMoveTarget = () => true; surface.setResourceMoveActive(true);
    state.engines[0].callbacks.focus("root"); button("Map settings").click();
    expect(plugin.openMapSettings).toHaveBeenCalledOnce();
    expect(button("Map settings").disabled).toBe(true);
    expect(root.querySelector("canvas")).toBe(canvas);
  });
  it("renders original child/sibling geometry and only enables siblings for non-root selections", async () => {
    map.nodes.push({ ...map.nodes[0]!, id: "child", parentId: "root", path: "Map/child.md", side: "left" });
    await start();
    expect(button("Add child topic").querySelector("path")?.getAttribute("d")).toBe("M17 8L17 12L17 16M13 12L21 12");
    expect(button("Add sibling topic").querySelector("path")?.getAttribute("d")).toBe("M17 13L17 17L17 21M13 17L21 17");
    expect(button("Add sibling topic").querySelector("circle")?.getAttribute("cx")).toBe("17");
    expect(button("Add child topic").querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(button("Add sibling topic").disabled).toBe(true);
    state.engines[0].callbacks.focus("root"); expect(button("Add sibling topic").disabled).toBe(true);
    state.engines[0].callbacks.focus("child"); expect(button("Add sibling topic").disabled).toBe(false);
    button("Add sibling topic").click(); expect(plugin.promptForTopic).toHaveBeenLastCalledWith(map, "child", true);
    plugin.resourceMoveActive = true; surface.setResourceMoveActive(true);
    expect(button("Add sibling topic").disabled).toBe(true);
    plugin.resourceMoveActive = false; surface.setResourceMoveActive(false);
    expect(button("Add sibling topic").disabled).toBe(false);
    map.nodes.pop(); surface.setReferenceSelection({ sourceNodeId: "child", targetNodeIds: [] });
    expect(button("Add sibling topic").disabled).toBe(true);
  });
  it("retains invalid-map guards and reload remains available", async () => {
    map.issues = ["Missing parent"]; await start();
    expect(button("Add child topic").disabled).toBe(true); expect(button("Map settings").disabled).toBe(true);
    expect(state.engines).toHaveLength(0);
    map.issues = []; button("Reload from Markdown").click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(state.engines).toHaveLength(1);
  });
  it("uses renamed titles and note paths without replacing the engine", async () => {
    await start(); const engine = state.engines[0];
    surface.reconcileIdentity({ ...map, path: "Moved/Renamed.md", title: "Renamed" });
    expect(button("Choose map").textContent).toBe("Renamed");
    expect(button("Choose map").title).toContain("Renamed");
    expect(surface.mapPath).toBe("Moved/Renamed.md");
    expect(engine.destroy).not.toHaveBeenCalled();
    expect(Array.from(root.querySelectorAll("button")).every((button) => button.type === "button" && button.hasAttribute("aria-label"))).toBe(true);
  });
});
