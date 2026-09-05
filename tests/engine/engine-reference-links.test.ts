// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmberlyEngineHost } from "../../src/emberly-engine/engine-host";
import type { EmberlyMap } from "../../src/shared/types";
import { installObsidianDom } from "../helpers/obsidian-dom";
// @ts-expect-error Original renderer deliberately remains JavaScript.
import LinkRenderer from "../../src/emberly-engine/tree/common/LinkRenderer.js";
// @ts-expect-error Original renderer deliberately remains JavaScript.
import NodeEventHandler from "../../src/emberly-engine/tree/common/NodeEventHandler.js";

const state = vi.hoisted(() => ({ tree: null as any, graphics: [] as any[], viewport: { x: 15, y: 20, scale: 0.8, resize: vi.fn() }, renderer: { resize: vi.fn(), destroy: vi.fn() } }));
vi.mock("../../src/emberly-engine/tree/pixi", () => ({
  Point: class { constructor(public x: number, public y: number) {} },
  Graphics: class {
    clear = vi.fn(); destroy = vi.fn(); lineStyle = vi.fn(); moveTo = vi.fn(); bezierCurveTo = vi.fn(); drawCircle = vi.fn();
    constructor() { state.graphics.push(this); }
  },
}));
vi.mock("../../src/emberly-engine/tree/renderer", () => ({ injectRenderer: (bounds: unknown, container: HTMLElement) => {
  container.createEl("canvas"); return { renderer: state.renderer, viewport: state.viewport, migrate: vi.fn(), dispose: vi.fn() };
} }));
vi.mock("../../src/emberly-engine/renderer-assets", () => ({ DEFAULT_AVATAR_URL: "" }));
vi.mock("../../src/emberly-engine/adapter/markdown-collection", () => ({ MarkdownNodeCollection: class {
  addNode(node: unknown) { return node; }
} }));
vi.mock("../../src/emberly-engine/tree/TreeRenderer", () => ({ default: class {
  constructor() { return state.tree; }
} }));

function node(id: string, y = 0) {
  return { id, isRoot: false, isVisible: true, isCollapsed: false, side: 1, height: 30, depth: 2,
    container: { x: 50, y }, textOffsetX: 5, renderText: { textWidth: 50 }, entity: { isCollapsed: false },
    getTextStyle: () => ({ fontSize: 20 }), getFirstInvisibleParent: vi.fn(), render: vi.fn() };
}

describe("engine reference overlay (legacy renderer, without WebGL)", () => {
  let host: EmberlyEngineHost, source: ReturnType<typeof node>, target: ReturnType<typeof node>, root: ReturnType<typeof node>;
  let container: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers(); installObsidianDom();
    source = node("source"); target = node("target", 100); root = { ...node("root", -50), isRoot: true };
    const handlers = new Map<string, (...args: any[]) => void>();
    const tree: any = { running: true, isLoaded: true, root,
      getNodeById: (id: string) => id === "source" ? source : id === "target" ? target : null,
      on: (event: string, fn: (...args: any[]) => void) => handlers.set(event, fn),
      emit: (event: string, ...args: any[]) => handlers.get(event)?.(...args),
      setDragEnabled: vi.fn(), setTickDirty: vi.fn(), panTo: vi.fn(), destroy: vi.fn() };
    state.tree = tree;
    tree.nodeEventHandler = { tree, activeNodeId: null, collapsedParent: null, tempUncollapsedNodes: [],
      setActiveNodeId: NodeEventHandler.prototype.setActiveNodeId };
    tree.linkRenderer = new LinkRenderer(tree);
    container = document.body.createDiv();
    container.onWindowMigrated = () => () => undefined;
    host = new EmberlyEngineHost(container, {} as EmberlyMap, { focus: vi.fn(), edit: vi.fn(), persist: vi.fn() });
  });
  afterEach(() => { host.destroy(); vi.useRealTimers(); document.body.empty(); vi.clearAllMocks(); });

  it("uses the original curve/highlight, deduplicates, and leaves viewport/canvas untouched", () => {
    const canvas = container.querySelector("canvas"), link = state.tree.linkRenderer;
    const viewport = { ...state.viewport };
    host.showReferenceLinks("source", ["target", "target", "source", "root", "missing"]);
    expect(link.targetNodeIds).toEqual(["target"]);
    expect(link.hasActiveNode()).toBe(true);
    expect(target.render).toHaveBeenCalled();
    expect(link.container.lineStyle).toHaveBeenLastCalledWith(15, 0xD3D3DA, 1, 0.5);
    expect(link.container.bezierCurveTo).toHaveBeenCalledTimes(1);
    host.showReferenceLinks("source", ["target"]);
    expect(link.container.bezierCurveTo).toHaveBeenCalledTimes(1);
    host.showReferenceLinks("target", ["source"]);
    expect(link.nodeId).toBe("target");
    expect(link.targetNodeIds).toEqual(["source"]);
    expect(state.tree.panTo).not.toHaveBeenCalled();
    expect(container.querySelector("canvas")).toBe(canvas);
    expect(state.viewport).toEqual(viewport);
  });

  it("keeps legacy collapsed-target circles without expanding or persisting the target", () => {
    const parent = node("collapsed-parent", 60);
    target.isVisible = false; target.getFirstInvisibleParent.mockReturnValue({ parent });
    host.showReferenceLinks("source", ["target"]);
    expect(state.tree.linkRenderer.container.drawCircle).toHaveBeenCalledTimes(1);
    expect(state.tree.linkRenderer.container.bezierCurveTo).toHaveBeenCalledTimes(1);
    expect(target.isVisible).toBe(false);
    expect(state.tree.nodeEventHandler.tempUncollapsedNodes).toEqual([]);
  });

  it("restores after forced same-topic visibility selection, clears on a different selection", () => {
    host.showReferenceLinks("source", ["target"]);
    state.tree.nodeEventHandler.setActiveNodeId("source", true);
    expect(state.tree.linkRenderer.targetNodeIds).toEqual(["target"]);
    state.tree.nodeEventHandler.setActiveNodeId("target");
    expect(state.tree.linkRenderer.targetNodeIds).toEqual([]);
    state.tree.nodeEventHandler.setActiveNodeId("source");
    expect(state.tree.linkRenderer.targetNodeIds).toEqual([]);
  });

  it("reapplies only the newest selection on loading and cannot resurrect a cleared selection", () => {
    state.tree.isLoaded = false;
    host.showReferenceLinks("source", ["target"]);
    host.showReferenceLinks("target", ["source"]);
    expect(state.tree.linkRenderer.nodeId).toBeNull();
    state.tree.isLoaded = true; state.tree.emit("onLoad"); vi.runAllTimers();
    expect(state.tree.linkRenderer.nodeId).toBe("target");
    host.clearReferenceLinks();
    state.tree.emit("onLoad"); vi.runAllTimers();
    expect(state.tree.linkRenderer.nodeId).toBeNull();
    expect(source.render).toHaveBeenCalled();
  });

  it("supports avatar-root sources without putting the root in the legacy node dictionary", () => {
    root.isCollapsed = true; // Roots have no text style in the real renderer.
    host.showReferenceLinks("root", ["target"]);
    expect(state.tree.linkRenderer.node).toBe(root);
    expect(state.tree.linkRenderer.container.bezierCurveTo).toHaveBeenCalledTimes(1);
  });

  it("includes a newly created destination when the live collection catches up with metadata", () => {
    const original = state.tree.getNodeById;
    state.tree.getNodeById = (id: string) => id === "target" ? null : original(id);
    host.showReferenceLinks("source", ["target"]);
    expect(state.tree.linkRenderer.targetNodeIds).toEqual([]);
    state.tree.getNodeById = original;
    host.addNode({} as Parameters<EmberlyEngineHost["addNode"]>[0]);
    expect(state.tree.linkRenderer.targetNodeIds).toEqual(["target"]);
    expect(state.tree.panTo).not.toHaveBeenCalled();
  });

  it("clears pending legacy links, removes highlights, and ignores callbacks after disposal", () => {
    host.showReferenceLinks("source", ["target"]);
    state.tree.linkRenderer.waitingNodeIds = ["source"];
    host.clearReferenceLinks();
    expect(state.tree.linkRenderer.targetNodeIds).toEqual([]);
    expect(state.tree.linkRenderer.waitingNodeIds).toBeNull();
    state.tree.emit("onLoad");
    host.destroy();
    host.showReferenceLinks("source", ["target"]); vi.runAllTimers();
    expect(state.tree.linkRenderer.nodeId).toBeNull();
    expect(state.tree.panTo).not.toHaveBeenCalled();
  });
});
