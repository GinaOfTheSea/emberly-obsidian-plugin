import { Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { EmberlyEngineHost } from "../emberly-engine/engine-host";
import type EmberlyMapsPlugin from "../main";
import type { EmberlyMap, EmberlyNode } from "../shared/types";
import type { TopicAppearance } from "../topics/topic-appearance";
import { changeAffectsMap, sameMapStructure, type MapFileChange } from "./map-file-changes";
import type { MapReferenceSelection } from "./map-reference-index";
import { setMapIcon } from "../ui/legacy-tree-icons";
import { needsCenterLayout } from "./map-layout";

/** The same map UI can live in a custom view or alongside a native editor. */
export class EmberlyMapSurface {
  private readonly labelId = `emberly-map-name-${crypto.randomUUID()}`;
  private selectedId: string | null = null;
  private engine: EmberlyEngineHost | null = null;
  private renderGeneration = 0;
  private collapseButton: HTMLButtonElement | null = null;
  private siblingButton: HTMLButtonElement | null = null;
  private settingsButton: HTMLButtonElement | null = null;
  private statusElement: HTMLElement | null = null;
  private titleElement: HTMLElement | null = null;
  private mapPickerButton: HTMLButtonElement | null = null;
  private displayedMap: EmberlyMap | undefined;
  private referenceSelection: MapReferenceSelection | null = null;
  private pendingFocus: { id: string; center: boolean } | null = null;
  private disposed = false;

  constructor(
    readonly contentEl: HTMLElement,
    readonly leaf: WorkspaceLeaf,
    private readonly plugin: EmberlyMapsPlugin,
    public mapPath: string,
    private readonly renderExtraActions?: (actions: HTMLElement) => void,
  ) {}
  dispose(): void {
    this.disposed = true;
    this.referenceSelection = null;
    ++this.renderGeneration;
    this.destroyEngine();
    this.contentEl.empty();
  }
  refresh(): void { this.render(); }
  refreshChanged(maps: EmberlyMap[], changes: MapFileChange[]): void {
    const current = maps.find((map) => this.displayedMap ? map.id === this.displayedMap.id : map.path === this.mapPath);
    const relevant = changes.filter((change) => changeAffectsMap(change, current, this.mapPath) || changeAffectsMap(change, this.displayedMap, this.mapPath));
    if (!relevant.length) return;
    if (!this.engine || !current || current.issues.length
      || (!sameMapStructure(this.displayedMap, current) && !this.engine.matchesStructure(current))) {
      this.render();
      return;
    }
    this.reconcileIdentity(current);
    // External property edits use the same in-place path as the topic header.
    for (const node of current.nodes) {
      const appearance: Partial<TopicAppearance> = {};
      for (const change of relevant) {
        if (change.after?.path !== node.path) continue;
        for (const field of change.appearanceFields) appearance[field] = node[field];
      }
      if (Object.keys(appearance).length) this.engine.applyAppearance(node.id, appearance);
    }
    this.displayedMap = current;
  }
  reconcileIdentity(current: EmberlyMap): void {
    if (this.disposed || (this.displayedMap && current.id !== this.displayedMap.id)) return;
    this.mapPath = current.path;
    this.titleElement?.setText(current.title);
    this.mapPickerButton?.setAttribute("title", `Choose map · ${current.title}`);
    for (const node of current.nodes) this.engine?.reconcileIdentity(node);
    this.engine?.applyMapCenter(current);
    // Don't overwrite topology here: resource refreshes can precede structural events.
    if (this.displayedMap) {
      const nodes = new Map(current.nodes.map((node) => [node.id, node]));
      this.displayedMap = { ...this.displayedMap, path: current.path, folder: current.folder, title: current.title,
        nodes: this.displayedMap.nodes.map((node) => {
          const latest = nodes.get(node.id);
          return latest ? { ...node, path: latest.path, title: latest.title } : node;
        }) };
    }
  }
  renamePath(oldPath: string, newPath: string): void {
    if (this.mapPath === oldPath || this.mapPath.startsWith(`${oldPath}/`)) this.mapPath = newPath + this.mapPath.slice(oldPath.length);
    const map = this.plugin.index.maps().find((candidate) => candidate.id === this.displayedMap?.id);
    if (map && !map.issues.length) this.reconcileIdentity(map);
  }
  fitMap(): void {
    this.engine?.resize();
    this.engine?.fit();
  }
  focusTopic(id: string, center = false): boolean {
    if (this.disposed || !this.displayedMap?.nodes.some((node) => node.id === id)) return false;
    this.selectedId = id;
    if (this.engine?.focusTopic(id, center)) this.pendingFocus = null;
    else this.pendingFocus = { id, center };
    this.updateCollapseButton();
    return true;
  }
  addTopic(mapPath: string, node: EmberlyNode): boolean {
    if (this.mapPath !== mapPath || !this.engine) return false;
    const added = this.engine.addNode(node);
    if (added) {
      this.statusElement?.setText("Topic added");
      this.plugin.syncReferenceViews();
    }
    return added;
  }
  applyTopicAppearance(mapPath: string, id: string, appearance: Partial<TopicAppearance>): void {
    if (this.mapPath === mapPath) this.engine?.applyAppearance(id, appearance);
  }
  reconcileResources(maps: EmberlyMap[]): void {
    const current = maps.find((map) => map.path === this.mapPath);
    if (!current || current.issues.length || !this.engine) return;
    const previous = new Map(this.displayedMap?.nodes.map((node) => [node.id, node.state & 4]));
    for (const node of current.nodes) {
      if (previous.get(node.id) !== (node.state & 4)) this.engine.applyAppearance(node.id, { state: node.state });
    }
    if (this.displayedMap) this.displayedMap = { ...this.displayedMap, nodes: this.displayedMap.nodes.map((node) => {
      const latest = current.nodes.find((candidate) => candidate.id === node.id);
      return latest ? { ...node, state: (node.state & ~4) | (latest.state & 4) } : node;
    }) };
  }
  setResourceMoveActive(active: boolean): void {
    this.engine?.setTopicDragging(!active);
    this.updateCollapseButton();
    if (this.settingsButton) this.settingsButton.disabled = active || Boolean(this.displayedMap?.issues.length);
    if (active) this.engine?.clearReferenceLinks();
    else this.applyReferenceSelection();
    this.statusElement?.setText(active ? "Move resource: click a destination topic · Esc to cancel" : "");
  }

  setReferenceSelection(selection: MapReferenceSelection | null): void {
    if (this.disposed) return;
    this.referenceSelection = selection;
    if (selection) this.selectedId = selection.sourceNodeId;
    this.applyReferenceSelection();
    this.updateCollapseButton();
  }
  private applyReferenceSelection(): void {
    if (this.disposed) return;
    const selection = this.referenceSelection;
    if (!selection || this.plugin.resourceMoveActive) this.engine?.clearReferenceLinks();
    else this.engine?.showReferenceLinks(selection.sourceNodeId, selection.targetNodeIds);
  }

  private render(): void {
    if (this.disposed) return;
    const generation = ++this.renderGeneration;
    this.destroyEngine();
    this.selectedId = null;
    this.collapseButton = null;
    this.siblingButton = null;
    this.settingsButton = null;
    this.statusElement = null;
    this.titleElement = null;
    this.mapPickerButton = null;
    const root = this.contentEl;
    root.empty();
    root.addClass("emberly-map-view");
    const map = this.plugin.index.mapByPath(this.mapPath);
    this.displayedMap = map;
    if (!map) {
      root.createDiv({ cls: "emberly-empty", text: "This map is not available yet. Open a map note and try again." });
      return;
    }
    const status = this.renderToolbar(root, map);
    if (map.issues.length) root.createDiv({ cls: "emberly-warning", text: map.issues.join(" ") });
    if (map.issues.length) {
      root.createDiv({ cls: "emberly-empty", text: "Resolve the topic hierarchy issues above, then reload. The map is not editable while its structure is invalid." });
      return;
    }
    if (!map.nodes.some((node) => !node.parentId)) {
      root.createDiv({ cls: "emberly-empty", text: "This map has no root topic." });
      return;
    }
    if (needsCenterLayout(map)) {
      const message = root.createDiv({ cls: "emberly-empty", text: "Updating map layout once its metadata is ready…" });
      void this.plugin.reconcileMapLayout(map.id).then(() => {
        if (this.disposed || generation !== this.renderGeneration) return;
        const latest = this.plugin.index.maps().find((candidate) => candidate.id === map.id);
        if (latest && !needsCenterLayout(latest)) this.render();
      }).catch((error) => {
        if (this.disposed || generation !== this.renderGeneration) return;
        message.setText(`Could not update the map layout. Reload to retry. ${error instanceof Error ? error.message : String(error)}`);
      });
      return;
    }
    const canvas = root.createDiv({ cls: "emberly-canvas" });
    (root.ownerDocument.defaultView ?? window).requestAnimationFrame(() => {
      if (generation !== this.renderGeneration || !canvas.isConnected) return;
      const latest = this.plugin.index.maps().find((candidate) => candidate.id === map.id) ?? map;
      if (needsCenterLayout(latest)) { this.render(); return; }
      this.engine = new EmberlyEngineHost(canvas, latest, {
        persist: (snapshot) => this.plugin.persistEngineEntity(map, snapshot),
        focus: (nodeId) => {
          if (this.plugin.selectResourceMoveTarget(map.id, nodeId)) return;
          this.selectedId = nodeId;
          status.setText("Topic selected");
          this.updateCollapseButton();
          this.showTopicNote(nodeId, false);
        },
        edit: (nodeId) => {
          if (this.plugin.selectResourceMoveTarget(map.id, nodeId)) return;
          this.showTopicNote(nodeId, true);
        },
        loaded: () => {
          if (this.disposed || generation !== this.renderGeneration) return;
          const focus = this.pendingFocus;
          if (focus && this.engine?.focusTopic(focus.id, focus.center)) this.pendingFocus = null;
          status.setText("");
          this.updateCollapseButton();
          this.setResourceMoveActive(this.plugin.resourceMoveActive);
          this.plugin.syncReferenceViews();
        },
      });
      this.setResourceMoveActive(this.plugin.resourceMoveActive);
      this.plugin.syncReferenceViews();
    });
  }

  private showTopicNote(nodeId: string, focusEditor: boolean): void {
    const map = this.plugin.index.maps().find((candidate) => candidate.id === this.displayedMap?.id);
    if (map?.nodes.some((node) => node.id === nodeId && !node.parentId)) {
      this.showMapSettings(map); return;
    }
    const path = this.engine?.entityPath(nodeId);
    if (!path) return;
    // The plugin serializes map and resource clicks together so the latest
    // request wins even when navigation begins from the adjacent pane.
    void this.plugin.openTopicFile(path, this.leaf, focusEditor).catch((error) => {
      console.error("Could not open Emberly topic note", error);
      new Notice("Could not open the topic note.");
    });
  }

  private showMapSettings(map: EmberlyMap): void {
    void this.plugin.openMapSettings(map, this.leaf).catch((error) => {
      new Notice(error instanceof Error ? error.message : "Could not open map settings.");
    });
  }

  private renderToolbar(container: HTMLElement, map: EmberlyMap): HTMLElement {
    const toolbar = container.createDiv({ cls: "emberly-toolbar", attr: { "aria-label": "Map controls" } });
    const navigation = toolbar.createDiv({ cls: "emberly-button-group emberly-map-navigation", attr: { role: "group", "aria-label": "Map navigation" } });
    this.mapPickerButton = navigation.createEl("button", { cls: "emberly-map-picker", attr: {
      type: "button", "aria-label": "Choose map", title: `Choose map · ${map.title}`, "aria-haspopup": "dialog",
    } });
    this.titleElement = this.mapPickerButton.createSpan({ cls: "emberly-map-name", text: map.title, attr: { id: this.labelId } });
    // Obsidian turns aria-label into a hover tooltip. Name the map region by
    // its visible title instead, so hovering anywhere on the canvas stays quiet.
    container.setAttribute("role", "region");
    container.setAttribute("aria-labelledby", this.labelId);
    setIcon(this.mapPickerButton.createSpan({ cls: "emberly-map-chevron", attr: { "aria-hidden": "true" } }), "chevron-down");
    this.mapPickerButton.addEventListener("click", () => this.plugin.chooseMap(!this.renderExtraActions));
    const status = container.createDiv({ cls: "emberly-map-status", text: `Loading ${map.nodes.length} topics…`,
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" } });
    this.statusElement = status;
    const editing = toolbar.createDiv({ cls: "emberly-button-group emberly-topic-actions", attr: { role: "group", "aria-label": "Topic actions" } });
    this.siblingButton = this.iconButton(editing, "emberly-new-sibling", "Add sibling topic", () => {
      if (this.selectedId) this.plugin.promptForTopic(this.displayedMap ?? map, this.selectedId, true);
    });
    this.iconButton(editing, "emberly-new-child", "Add child topic", () => void this.plugin.promptForTopic(this.displayedMap ?? map, this.selectedId)).disabled = map.issues.length > 0;
    this.collapseButton = this.iconButton(editing, "emberly-collapse", "Select a branch topic to collapse", () => {
      const collapsed = this.selectedId ? this.engine?.toggleCollapse(this.selectedId) : null;
      if (collapsed === null || collapsed === undefined) status.setText("Select a topic with children");
      else status.setText(collapsed ? "Topic collapsed" : "Topic expanded");
      this.updateCollapseButton();
    });
    this.updateCollapseButton();
    const actions = toolbar.createDiv({ cls: "emberly-toolbar-actions" });
    const settings = actions.createDiv({ cls: "emberly-button-group", attr: { role: "group", "aria-label": "Map view controls" } });
    this.settingsButton = this.iconButton(settings, "emberly-map-settings", "Map settings", () => this.showMapSettings(this.displayedMap ?? map));
    this.settingsButton.disabled = map.issues.length > 0 || this.plugin.resourceMoveActive;
    if (this.renderExtraActions) {
      const panels = actions.createDiv({ cls: "emberly-button-group", attr: { role: "group", "aria-label": "Notes panel controls" } });
      this.renderExtraActions(panels);
    }
    const viewport = container.createDiv({ cls: "emberly-viewport-controls emberly-button-group", attr: { role: "group", "aria-label": "Map zoom" } });
    this.iconButton(viewport, "minus", "Zoom out", () => this.engine?.zoom(-1));
    this.iconButton(viewport, "plus", "Zoom in", () => this.engine?.zoom(1));
    this.iconButton(viewport, "scan", "Fit map", () => this.fitMap());
    return status;
  }

  private iconButton(container: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = container.createEl("button", { attr: { type: "button", "aria-label": label, title: label } });
    setMapIcon(button, icon);
    button.addEventListener("click", action);
    return button;
  }

  private updateCollapseButton(): void {
    if (this.siblingButton) {
      const current = this.plugin.index.maps().find((map) => map.id === this.displayedMap?.id);
      const node = current?.nodes.find((node) => node.id === this.selectedId);
      this.siblingButton.disabled = !node?.parentId || !current?.nodes.some((parent) => parent.id === node.parentId)
        || Boolean(current.issues.length) || this.plugin.resourceMoveActive;
    }
    const button = this.collapseButton;
    if (!button) return;
    const state = this.selectedId ? this.engine?.collapseState(this.selectedId) ?? null : null;
    const label = state?.collapsed ? "Expand selected topic" : state ? "Collapse selected topic" : "Select a branch topic to collapse";
    button.disabled = state === null;
    button.setAttr("aria-label", label);
    button.setAttr("title", label);
    button.setAttr("aria-pressed", String(state?.collapsed ?? false));
    button.empty();
    setMapIcon(button, state?.collapsed ? "emberly-expand" : "emberly-collapse");
  }

  private destroyEngine(): void {
    this.engine?.destroy();
    this.engine = null;
  }
}
