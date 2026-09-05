import type { EmberlyMap, EmberlyNode } from "../shared/types";
import type { TopicAppearance } from "../topics/topic-appearance";
import { DEFAULT_AVATAR_URL } from "./renderer-assets";
import { MarkdownNodeCollection, type EngineEntitySnapshot } from "./adapter/markdown-collection";

// The original Emberly renderer is intentionally preserved as JavaScript.
import TreeRenderer from "./tree/TreeRenderer.js";
import { injectRenderer } from "./tree/renderer.js";
import type { EngineRenderer, EngineTree, EngineViewport } from "./engine-contract";

interface EngineCallbacks {
  persist: (snapshot: EngineEntitySnapshot) => void | Promise<void>;
  focus: (nodeId: string) => void;
  edit: (nodeId: string) => void;
  loaded?: () => void;
}

export class EmberlyEngineHost {
  private readonly renderer: EngineRenderer;
  private readonly viewport: EngineViewport;
  private readonly tree: EngineTree;
  private readonly collection: MarkdownNodeCollection;
  private resizeObserver: ResizeObserver;
  private readonly disposeInjection: () => void;
  private readonly stopMigration: () => void;
  private cancelLoaded: (() => void) | undefined;
  private references: { source: string; targets: string[] } | null = null;
  private applyingReferences = false;
  private disposed = false;

  constructor(private readonly container: HTMLElement, map: EmberlyMap, callbacks: EngineCallbacks) {
    const bounds = container.getBoundingClientRect();
    const doc = container.ownerDocument;
    const dark = doc.body.classList.contains("theme-dark");
    const injected = injectRenderer(
      { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) },
      container,
      doc.body.classList.contains("is-mobile"),
      dark ? 0x202020 : 0xf5f7f6,
    );
    this.renderer = injected.renderer;
    this.viewport = injected.viewport;
    this.disposeInjection = () => injected.dispose();
    this.collection = new MarkdownNodeCollection(map, callbacks.persist, DEFAULT_AVATAR_URL);
    this.tree = new TreeRenderer(map.id, false, this.renderer, this.viewport, this.collection, dark ? "dark" : "light");
    this.tree.setDragEnabled(true);
    this.tree.on("onActiveNodeChanged", (id: string | null) => {
      if (this.applyingReferences) return;
      if (this.references?.source === id) this.applyReferenceLinks();
      else this.clearReferenceLinks();
    });
    this.tree.on("onNodeFocused", (node: { id: string }) => {
      this.tree.nodeEventHandler.setActiveNodeId(node.id);
      callbacks.focus(node.id);
    });
    this.tree.on("onRootFocused", (node: { id: string }) => {
      this.tree.nodeEventHandler.setActiveNodeId(node.id);
      callbacks.focus(node.id);
    });
    this.tree.on("onNodeEdit", (node: { id: string }) => callbacks.edit(node.id));
    const scheduleLoaded = (): void => {
      const win = container.ownerDocument.defaultView!;
      const timer = win.setTimeout(() => {
        this.cancelLoaded = undefined;
        if (this.disposed || !this.tree.running) return;
        this.fit();
        this.applyReferenceLinks();
        callbacks.loaded?.();
      }, 0);
      this.cancelLoaded = () => win.clearTimeout(timer);
    };
    this.tree.on("onLoad", scheduleLoaded);
    this.resizeObserver = this.observeSize();
    this.stopMigration = container.onWindowMigrated(() => {
      if (this.disposed) return;
      injected.migrate();
      this.tree.migrateWindow();
      if (this.cancelLoaded) { this.cancelLoaded(); scheduleLoaded(); }
      this.resizeObserver.disconnect();
      this.resizeObserver = this.observeSize();
      this.resize();
    });
  }

  private observeSize(): ResizeObserver {
    const win = this.container.ownerDocument.defaultView!;
    const observer = new win.ResizeObserver(() => this.resize());
    observer.observe(this.container);
    return observer;
  }

  fit(): void { if (this.tree?.root) this.tree.panTo(this.tree.root, 0, 0, true); }
  showReferenceLinks(sourceNodeId: string, targetNodeIds: string[]): void {
    if (this.disposed) return;
    this.references = { source: sourceNodeId, targets: [...new Set(targetNodeIds)] };
    this.applyReferenceLinks();
  }
  clearReferenceLinks(): void {
    this.references = null;
    if (this.disposed) return;
    if (this.tree.linkRenderer.nodeId || this.tree.linkRenderer.waitingNodeIds) {
      this.tree.linkRenderer.clear();
      this.tree.setTickDirty();
    }
  }
  private applyReferenceLinks(): void {
    const links = this.references;
    if (!links || this.disposed || !this.tree.running || !this.tree.isLoaded || this.applyingReferences) return;
    if (!this.tree.getNodeById(links.source) && this.tree.root?.id !== links.source) { this.clearReferenceLinks(); return; }
    this.applyingReferences = true;
    try {
      // Native history/resource navigation also selects the source topic. This
      // uses only legacy transient visibility handling, never fit/pan or writes.
      if (this.selectedId() !== links.source) this.tree.nodeEventHandler.setActiveNodeId(links.source);
      const targets = links.targets.filter((id) => {
        const node = this.tree.getNodeById(id);
        return node && !node.isRoot && id !== links.source;
      });
      // The original renderer compares sets and skips unchanged connections.
      this.tree.linkRenderer.setLinkedNodes(targets, links.source);
    } finally { this.applyingReferences = false; }
  }
  setTopicDragging(enabled: boolean): void { this.tree.setDragEnabled(enabled); }
  zoom(direction: number): void { this.tree?.zoom(direction); }
  focusTopic(id: string, center = false): boolean {
    if (this.disposed || !this.tree?.running || !this.tree.isLoaded) return false;
    const node = this.tree.getNodeById(id);
    if (!node) return false;
    this.tree.nodeEventHandler.setActiveNodeId(id);
    if (center) this.tree.panTo(node, 0, 0, true);
    return true;
  }
  selectedId(): string | null { return this.tree?.nodeEventHandler?.activeNodeId ?? null; }
  entityPath(id: string): string | undefined { return this.collection.getEntityById(id)?.sourcePath; }
  matchesStructure(map: EmberlyMap): boolean { return this.collection.matchesStructure(map); }
  reconcileIdentity(node: EmberlyNode): void { this.collection.reconcileIdentity(node); }
  applyMapCenter(map: EmberlyMap): void { this.collection.applyMapCenter(map); }
  addNode(node: EmberlyNode): boolean {
    const added = Boolean(this.collection.addNode(node));
    if (added) this.applyReferenceLinks();
    return added;
  }
  applyAppearance(id: string, appearance: Partial<TopicAppearance>): void { this.collection.applyAppearance(id, appearance); }
  nodeCount(): number { return this.collection.entityIndex.length; }
  collapseState(id: string): { collapsed: boolean } | null {
    const node = this.tree?.getNodeById(id);
    if (!node || node === this.tree.root || node.children.length === 0) return null;
    return { collapsed: Boolean(node.entity.isCollapsed) };
  }
  toggleCollapse(id: string): boolean | null {
    const state = this.collapseState(id);
    const node = this.tree?.getNodeById(id);
    if (!state || !node) return null;
    const collapsed = !state.collapsed;
    node.entity.setIsCollapsed(collapsed, { instanceId: this.tree.instanceId });
    node.setIsCollapsed(collapsed);
    node.render();
    return collapsed;
  }
  resize(): void {
    if (this.disposed) return;
    const bounds = this.container.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    this.renderer.resize(bounds.width, bounds.height);
    this.viewport.resize(bounds.width, bounds.height);
    this.tree.setTickDirty();
  }
  destroy(): void {
    if (this.disposed) return;
    this.clearReferenceLinks();
    this.disposed = true;
    this.cancelLoaded?.();
    this.stopMigration();
    this.resizeObserver.disconnect();
    try { this.tree.destroy(); } catch (error) { console.error("Could not destroy Emberly renderer", error); }
    this.disposeInjection();
    try { this.renderer.destroy(true); } catch (error) { console.error("Could not destroy Pixi renderer", error); }
    this.container.empty();
  }
}

export type { EngineEntitySnapshot } from "./adapter/markdown-collection";
