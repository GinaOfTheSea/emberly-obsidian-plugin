import { MarkdownView, Notice, Plugin, TFile, TFolder, normalizePath, type WorkspaceLeaf } from "obsidian";
import { EmberlyMapView, VIEW_TYPE_EMBERLY_MAP } from "./maps/map-view";
import { IntegratedMapPane } from "./maps/integrated-map-pane";
import type { EmberlyMapSurface } from "./maps/map-surface";
import type { EngineEntitySnapshot } from "./emberly-engine/engine-host";
import { LocalWriteGuard } from "./vault/local-write-guard";
import { MapFolderPickerModal, MapPickerModal, NameModal, TopicNamesModal, TrashMapModal } from "./ui/modals";
import { loadEmberlyFonts } from "./emberly-engine/renderer-assets";
import type { EmberlyLayout, EmberlyMap, EmberlyNode, MapIconVisibility } from "./shared/types";
import { MapFileOperations } from "./maps/map-file-operations";
import { EmberlyVaultIndex } from "./vault/vault-index";
import { appendTopicOrder, topicMoveProperties } from "./topics/topic-hierarchy";
import { TopicNotePane, type TopicPaneNavigation, type ResourceMoveSession } from "./topics/topic-note-pane";
import { appearanceProperties, readTopicAppearance, type TopicAppearance, type TopicAppearanceChange, type TopicIdentity } from "./topics/topic-appearance";
import { MapFileChanges, type MapFileChange } from "./maps/map-file-changes";
import { readResourceSettings, resourceIdentity, resourceProperties, type ResourceChange, type ResourceIdentity, type ResourceSettings } from "./resources/resource-properties";
import { createResources } from "./resources/resource-create";
import { frontmatter, safeName } from "./vault/vault-files";
import type { MapCenterChange } from "./maps/map-center";
import { isMapNotePath, mapNoteFilename, renamedMapPath, renamedNotePath } from "./vault/note-metadata";
import { registerPluginEvents } from "./app/plugin-events";
import { ResourceMoves } from "./resources/resource-move";
import { validateTransfer } from "./resources/resource-transfer";
import { ReferenceCoordinator } from "./app/reference-coordinator";
import { TOPIC_PARENT_LINK_PROPERTY, topicParentLink } from "./topics/topic-parent-link";
import { MapOperationQueue } from "./maps/map-operation-queue";
import { PaneCoordinator } from "./app/pane-coordinator";
import { GraphLinkCoordinator } from "./vault/graph-link-coordinator";
import { FrontmatterEditor, type PropertyUpdate } from "./vault/frontmatter-editor";
import { MapSettingsController } from "./maps/map-settings-controller";

const MAPS_FOLDER = "Emberly Maps";

export default class EmberlyMapsPlugin extends Plugin {
  index = new EmberlyVaultIndex(this.app);
  private stopped = false;
  private refreshTimer: number | undefined;
  private readonly mapFileChanges = new MapFileChanges();
  private pendingMapChanges: MapFileChange[] = [];
  private forceMapRefresh = false;
  private readonly pendingLocalWrites = new LocalWriteGuard();
  private readonly frontmatterEditor = new FrontmatterEditor(this.app, () => this.index, this.pendingLocalWrites);
  private readonly panes = new PaneCoordinator();
  private get topicLeaves() { return this.panes.topicLeaves; }
  private get topicPanes() { return this.panes.topicPanes; }
  private get openInMapActions() { return this.panes.openInMapActions; }
  private get integratedPanes() { return this.panes.integratedPanes; }
  private get integratedNativeOpens() { return this.panes.integratedNativeOpens; }
  private get topicPaneFiles() { return this.panes.topicPaneFiles; }
  private get topicOpenRequests() { return this.panes.topicOpenRequests; }
  private readonly mapOperations = new MapOperationQueue();
  private readonly mapSettings = new MapSettingsController({
    app: this.app,
    index: () => this.index,
    stopped: () => this.stopped,
    queueWrite: (mapId, action) => this.queueMapWrite(mapId, action),
    updateProperties: (file, update) => this.updateProperties(file, update),
    surfaces: () => this.mapSurfaces(),
    syncTopicPanes: () => this.syncTopicPanes(),
  });
  private resourceRefreshTimer?: number;
  private pluginData: Record<string, unknown> = {};
  private moveSession?: ResourceMoveSession;
  private moveBusy = false;
  private autoOpenTimer?: number;
  private readonly references = new ReferenceCoordinator({
    app: this.app,
    vaultIndex: () => this.index,
    surfaces: () => this.mapSurfaces(),
    associatedFile: (surface) => {
      const leaf = this.topicLeaves.get(surface.leaf);
      return leaf?.view instanceof MarkdownView && this.workspaceContainsLeaf(leaf) ? leaf.view.file : null;
    },
    selectionBlocked: (surface) => this.resourceMoveActive || this.topicOpenRequests.has(surface.leaf),
    stopped: () => this.stopped,
    refresh: () => this.refreshReferenceIndex(),
  });
  private readonly graphLinks = new GraphLinkCoordinator({
    app: this.app,
    vaultIndex: () => this.index,
    stopped: () => this.stopped,
    queueMapWrite: (mapId, action) => this.queueMapWrite(mapId, action),
    updateProperties: (file, update) => this.updateProperties(file, update),
  });
  get resourceMoveActive(): boolean { return Boolean(this.moveSession); }

  async onload(): Promise<void> {
    try {
      const data: unknown = await this.loadData();
      this.pluginData = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    } catch {
      // Keep maps usable, but never overwrite an unreadable recovery record.
      this.pluginData = { resourceTransfer: { unreadable: true } };
      new Notice("Emberly's pending-move data could not be read. Maps remain available; inspect the plugin's data.json before moving resources.", 15000);
    }
    this.registerView(VIEW_TYPE_EMBERLY_MAP, (leaf) => new EmberlyMapView(leaf, this));
    this.addRibbonIcon("network", "Open Emberly map", () => this.chooseMap());
    this.addCommand({ id: "open-current-map", name: "Open current note as a map", checkCallback: (checking) => {
      const file = this.app.workspace.getActiveFile();
      const map = file ? this.index.mapContaining(file.path) : undefined;
      if (!map) return false;
      if (!checking) void this.openMap(map);
      return true;
    }});
    this.addCommand({ id: "choose-map", name: "Open map…", callback: () => this.chooseMap() });
    this.addCommand({ id: "choose-map-separate", name: "Open map in separate panes…", callback: () => this.chooseMap(true) });
    this.addCommand({ id: "close-integrated-map", name: "Return to plain note", checkCallback: (checking) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !this.integratedPanes.has(view.leaf)) return false;
      if (!checking) this.closeIntegratedMap(view.leaf);
      return true;
    }});
    this.addCommand({ id: "create-map", name: "Create map…", callback: () => this.promptForMap() });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile)) return;
      const matches = this.index.maps().filter((map) => map.path === file.path);
      const map = matches.length === 1 ? matches[0] : undefined;
      if (!map || map.issues.length) return;
      menu.addItem((item) => item
        .setTitle("Open as Emberly map")
        .setIcon("network")
        .onClick(() => void this.openMap(map)));
    }));
    this.addCommand({ id: "recover-resource-move", name: "Recover pending resource move", callback: () => void this.recoverResourceMove() });
    this.addCommand({ id: "cancel-pending-resource-move", name: "Cancel uncommitted resource move (keep copied files)", callback: () => void this.cancelPendingTransfer() });
    this.addCommand({ id: "review-resource-issues", name: "Review resource ownership issues", callback: () => {
      const issues = this.index.resourceCatalog().issues;
      new Notice(issues.length ? issues.map((issue) => issue.message).join("\n") : "No resource ownership issues found.", 15000);
    }});
    const keyboardDocuments = new WeakSet<Document>();
    const registerKeyboard = (doc: Document): void => {
      if (keyboardDocuments.has(doc)) return;
      keyboardDocuments.add(doc);
      this.registerDomEvent(doc, "keydown", (event) => {
        if (event.key === "Escape" && this.moveSession && !this.moveBusy) {
          event.preventDefault(); this.moveSession.cancel();
        }
      });
    };
    registerKeyboard(document);
    this.app.workspace.iterateAllLeaves((leaf) => registerKeyboard(leaf.view.containerEl.ownerDocument));
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => registerKeyboard(win.document)));
    registerPluginEvents({
      plugin: this,
      index: this.index,
      localWrites: this.pendingLocalWrites,
      mapFileChanges: this.mapFileChanges,
      stopped: () => this.stopped,
      pendingTransfer: () => Boolean(this.pluginData.resourceTransfer),
      notifyPendingTransfer: () => new Notice("A resource move was interrupted. Run “Emberly Maps: Recover pending resource move”. Copies and originals were kept.", 15000),
      mapSurfaces: () => this.mapSurfaces(),
      invalidateReferences: () => this.invalidateReferences(),
      scheduleReferences: (path) => this.scheduleReferences(path),
      syncTopicPanes: () => this.syncTopicPanes(),
      refreshResourceIndicators: () => this.refreshResourceIndicators(),
      refreshMapCenters: () => this.refreshMapCenters(),
      refreshViews: (change) => this.refreshViews(change),
      graphLinkMapNeedingRepair: (file, properties) => this.graphLinkMapNeedingRepair(file, properties),
      scheduleGraphLinkReconciliation: (ids) => this.scheduleGraphLinkReconciliation(ids),
      scheduleLayoutReconciliation: () => this.scheduleLayoutReconciliation(),
      scheduleAutomaticMapOpen: (file) => this.scheduleAutomaticMapOpen(file),
      retryUnresolvedReferences: () => this.references.retryUnresolved(),
      updatePanePresentation: (view) => this.topicPanes.get(view.leaf)?.updatePresentation(),
    });
  }

  onunload(): void {
    this.stopped = true;
    if (this.autoOpenTimer !== undefined) window.clearTimeout(this.autoOpenTimer);
    this.references.dispose();
    this.moveSession?.cancel();
    if (this.resourceRefreshTimer !== undefined) window.clearTimeout(this.resourceRefreshTimer);
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.mapSettings.dispose();
    this.graphLinks.dispose();
    this.pendingMapChanges = [];
    this.mapFileChanges.reset([]);
    this.pendingLocalWrites.clear();
    this.mapOperations.dispose();
    this.panes.dispose();
  }

  colorFor(index: number): string {
    return ["#e57373", "#f2a65a", "#e6c75a", "#72b88e", "#5ba7d1", "#7d86d8", "#a979c9", "#d2769c"][Math.abs(index) % 8] ?? "#5ba7d1";
  }

  async openMap(map: EmberlyMap, separate = false): Promise<void> {
    await loadEmberlyFonts();
    try { await this.reconcileMapLayout(map.id); }
    catch (error) { new Notice(`Could not update map layout: ${error instanceof Error ? error.message : String(error)}`); return; }
    if (this.stopped) return;
    map = this.index.maps().find((candidate) => candidate.id === map.id) ?? map;
    if (!separate) {
      const file = this.index.file(map.nodes.find((node) => !node.parentId)?.path ?? map.path);
      if (!file) { new Notice("The map's root note is unavailable."); return; }
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(file, { active: true });
      if (!this.workspaceContainsLeaf(leaf) || !(leaf.view instanceof MarkdownView) || leaf.view.file !== file) return;
      this.topicLeaves.set(leaf, leaf);
      try {
        const pane = new IntegratedMapPane(leaf.view, this, map);
        this.integratedPanes.set(leaf, pane);
        this.syncTopicPanes();
        pane.start();
        await this.app.workspace.revealLeaf(leaf);
        if (this.integratedPanes.get(leaf) === pane) pane.focusMap();
      } catch (error) {
        this.closeIntegratedMap(leaf);
        console.error("Could not open the integrated Emberly layout", error);
        new Notice("Could not open the integrated layout. The native note is still available; try Open map in separate panes.");
      }
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_EMBERLY_MAP, active: true, state: { mapPath: map.path } });
    await this.app.workspace.revealLeaf(leaf);
  }

  closeIntegratedMap(leaf: WorkspaceLeaf): void {
    const pane = this.integratedPanes.get(leaf);
    this.integratedPanes.delete(leaf);
    this.integratedNativeOpens.delete(leaf);
    pane?.dispose();
    this.releaseTopicLeaf(leaf);
    this.syncOpenInMapActions();
  }

  private noteMapTarget(file: TFile): { map: EmberlyMap; node: EmberlyNode } | undefined {
    const properties = this.index.propertiesFor(file);
    let mapId: string | undefined;
    let nodeId: string | undefined;
    if (properties.emberly === "map" && properties["emberly-format"] === 2
      && typeof properties["emberly-id"] === "string" && typeof properties["emberly-root-id"] === "string") {
      mapId = properties["emberly-id"];
      nodeId = properties["emberly-root-id"];
    } else if (properties.emberly === "topic" && properties["emberly-format"] === 2
      && typeof properties["emberly-id"] === "string" && typeof properties["emberly-map"] === "string") {
      mapId = properties["emberly-map"];
      nodeId = properties["emberly-id"];
    } else {
      const identity = resourceIdentity(properties);
      const resources = identity ? this.index.resourceCatalog().resources.filter((resource) => resource.path === file.path
        && resource.id === identity.id && resource.mapId === identity.mapId) : [];
      if (resources.length !== 1) return undefined;
      mapId = resources[0]!.mapId;
      nodeId = resources[0]!.topicId;
    }
    const maps = this.index.maps().filter((map) => map.id === mapId);
    if (maps.length !== 1 || maps[0]!.issues.length) return undefined;
    const map = maps[0]!;
    const node = map.nodes.find((candidate) => candidate.id === nodeId
      && (properties.emberly === "resource" || candidate.path === file.path));
    return node ? { map, node } : undefined;
  }

  private async openNoteInMap(view: MarkdownView): Promise<void> {
    const file = view.file;
    const initial = file && this.noteMapTarget(file);
    if (!file || !initial || view.leaf.view !== view || this.integratedPanes.has(view.leaf)) {
      new Notice("This note is not part of a valid Emberly map.");
      return;
    }
    try { await this.reconcileMapLayout(initial.map.id); }
    catch (error) { new Notice(`Could not update map layout: ${error instanceof Error ? error.message : String(error)}`); return; }
    if (this.stopped || view.leaf.view !== view || view.file !== file || !this.workspaceContainsLeaf(view.leaf)) return;
    const current = this.noteMapTarget(file);
    if (!current || current.map.id !== initial.map.id || current.node.id !== initial.node.id) {
      new Notice("The note changed while its map was opening. Try again.");
      return;
    }
    this.topicLeaves.set(view.leaf, view.leaf);
    try {
      const pane = new IntegratedMapPane(view, this, current.map);
      this.integratedPanes.set(view.leaf, pane);
      this.syncTopicPanes();
      pane.start();
      pane.surface.focusTopic(current.node.id, true);
      await this.app.workspace.revealLeaf(view.leaf);
      if (this.integratedPanes.get(view.leaf) === pane) pane.focusMap();
    } catch (error) {
      this.closeIntegratedMap(view.leaf);
      console.error("Could not open this Emberly note in its map", error);
      new Notice("Could not open this note in map mode. The native note is still available.");
    }
  }

  private mapSurfaces(): EmberlyMapSurface[] {
    const surfaces = [...this.integratedPanes.values()].map((pane) => pane.surface);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_EMBERLY_MAP)) {
      if (leaf.view instanceof EmberlyMapView) surfaces.push(leaf.view.surface);
    }
    return surfaces;
  }

  private invalidateReferences(): void {
    this.references.invalidate();
  }

  private scheduleReferences(path?: string): void {
    this.references.schedule(path);
  }

  private refreshReferenceIndex(): void {
    this.references.refresh();
  }

  /** Each canvas follows its associated native pane, never the global active tab. */
  syncReferenceViews(): void {
    this.references.syncViews();
  }

  async openFile(path: string): Promise<void> {
    const file = this.index.file(path);
    if (!file) { new Notice(`Could not find ${path}`); return; }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  async openTopicFile(path: string, mapLeaf: WorkspaceLeaf, focusEditor = true, navigation: TopicPaneNavigation = {}): Promise<void> {
    // Map clicks and resource navigation share a queue. A slow earlier open
    // must not replace the note selected by a later click.
    await this.panes.runLatest(mapLeaf,
      (request) => this.displayTopicFile(path, mapLeaf, focusEditor, navigation, request),
      () => this.syncReferenceViews());
  }

  async openMapSettings(map: EmberlyMap, mapLeaf: WorkspaceLeaf): Promise<void> {
    if (this.resourceMoveActive) return;
    const current = this.editableMapSettings(map);
    const root = current.nodes.find((node) => !node.parentId);
    if (!root) throw new Error("The map's root topic is missing.");
    // Use the same native note pane and navigation queue as topic/resource clicks.
    await this.openTopicFile(root.path, mapLeaf, false, { section: "settings" });
  }

  private async displayTopicFile(path: string, mapLeaf: WorkspaceLeaf, focusEditor: boolean, navigation: TopicPaneNavigation, request: symbol): Promise<void> {
    if (!this.workspaceContainsLeaf(mapLeaf)) return;
    const file = this.index.file(path);
    if (!file) { new Notice(`Could not find ${path}`); return; }

    let topicLeaf = this.topicLeaves.get(mapLeaf);
    let created = false;
    if (!topicLeaf || !this.workspaceContainsLeaf(topicLeaf)) {
      const anchor = this.workspaceContainsLeaf(mapLeaf) ? mapLeaf : undefined;
      topicLeaf = anchor
        ? this.app.workspace.createLeafBySplit(anchor, "vertical", false)
        : this.app.workspace.getLeaf("split", "vertical");
      this.topicLeaves.set(mapLeaf, topicLeaf);
      created = true;
    }

    const integrated = this.integratedPanes.get(mapLeaf);
    this.integratedNativeOpens.set(mapLeaf, file);
    try {
      // A repeated click must not reset the native cursor, scroll or undo state.
      if (!(topicLeaf.view instanceof MarkdownView) || topicLeaf.view.file !== file) await topicLeaf.openFile(file, { active: false });
      // Inactive leaves need not emit file-open. Observe our own navigation
      // while the expected-file marker is still set in both layouts.
      this.syncTopicPanes();
    } finally {
      if (this.integratedNativeOpens.get(mapLeaf) === file) this.integratedNativeOpens.delete(mapLeaf);
    }
    if (this.topicOpenRequests.get(mapLeaf) !== request || !this.workspaceContainsLeaf(mapLeaf) || !this.workspaceContainsLeaf(topicLeaf)) return;
    await this.app.workspace.revealLeaf(topicLeaf);
    if (this.topicOpenRequests.get(mapLeaf) !== request || !this.workspaceContainsLeaf(mapLeaf) || !this.workspaceContainsLeaf(topicLeaf)) return;
    this.syncTopicPanes();
    if (this.topicOpenRequests.get(mapLeaf) !== request) return;
    this.topicPanes.get(topicLeaf)?.showFile(navigation);
    this.app.workspace.setActiveLeaf(focusEditor ? topicLeaf : mapLeaf, { focus: true });
    integrated?.showInspector();
    if (integrated && !focusEditor) integrated.focusMap();
    else if (focusEditor && navigation.section !== "settings" && topicLeaf.view instanceof MarkdownView && topicLeaf.view.getMode() === "source"
      && !topicLeaf.view.containerEl.classList.contains("emberly-map-show-settings")) topicLeaf.view.editor.focus();
    if (created && mapLeaf.view instanceof EmberlyMapView) {
      window.setTimeout(() => mapLeaf.view instanceof EmberlyMapView && mapLeaf.view.surface.fitMap(), 150);
    }
  }

  releaseTopicLeaf(mapLeaf: WorkspaceLeaf): void {
    this.topicOpenRequests.delete(mapLeaf);
    const topicLeaf = this.topicLeaves.get(mapLeaf);
    this.topicLeaves.delete(mapLeaf);
    this.topicPaneFiles.delete(mapLeaf);
    this.integratedNativeOpens.delete(mapLeaf);
    if (topicLeaf && ![...this.topicLeaves.values()].includes(topicLeaf)) {
      this.topicPanes.get(topicLeaf)?.dispose();
      this.topicPanes.delete(topicLeaf);
    }
    this.syncReferenceViews();
  }

  private syncTopicPanes(): void {
    this.index.withSnapshot(() => this.updateTopicPanes());
  }

  private updateTopicPanes(): void {
    const liveLeaves = new Set<WorkspaceLeaf>();
    this.app.workspace.iterateAllLeaves((leaf) => { liveLeaves.add(leaf); });
    for (const [leaf, pane] of this.integratedPanes) {
      if (pane.view.file && pane.file !== pane.view.file && this.integratedNativeOpens.get(leaf) !== pane.view.file) {
        // Native links/history win over queued map clicks.
        this.topicOpenRequests.delete(leaf);
      }
      const switchingFile = this.integratedNativeOpens.has(leaf) && !pane.view.file;
      if (!liveLeaves.has(leaf) || leaf.view !== pane.view || (!switchingFile && !pane.acceptsCurrentFile())) this.closeIntegratedMap(leaf);
      else pane.ensureMounted();
    }
    const wanted = new Map<WorkspaceLeaf, MarkdownView>();
    for (const [mapLeaf, topicLeaf] of this.topicLeaves) {
      if (!liveLeaves.has(mapLeaf) || !liveLeaves.has(topicLeaf)) {
        this.releaseTopicLeaf(mapLeaf);
        continue;
      }
      const view = topicLeaf.view;
      if (!this.integratedPanes.has(mapLeaf) && view instanceof MarkdownView) {
        const previous = this.topicPaneFiles.get(mapLeaf);
        if (view.file && previous !== undefined && previous !== view.file && this.integratedNativeOpens.get(mapLeaf) !== view.file) {
          this.topicOpenRequests.delete(mapLeaf);
        }
        this.topicPaneFiles.set(mapLeaf, view.file);
      }
      if (!(view instanceof MarkdownView) || !view.file || this.index.isMapAsset(view.file.path)) continue;
      const properties = this.index.propertiesFor(view.file);
      const kind = properties.emberly;
      // The map document is the canonical root note, so it needs the same
      // inspector wrapper as topic/resource notes. TopicNotePane will expose
      // Map settings only when this exact map file is the validated root.
      if (kind === "map" || kind === "topic" || kind === "resource") wanted.set(topicLeaf, view);
    }
    for (const [leaf, pane] of this.topicPanes) {
      if (wanted.get(leaf) !== pane.view) {
        pane.dispose();
        this.topicPanes.delete(leaf);
      }
    }
    for (const [leaf, view] of wanted) {
      const pane = this.topicPanes.get(leaf);
      if (pane) pane.update();
      else this.topicPanes.set(leaf, new TopicNotePane(view, this.index, async (path, navigation) => {
        const owner = [...this.topicLeaves].find(([, topicLeaf]) => topicLeaf === leaf)?.[0];
        if (owner) await this.openTopicFile(path, owner, true, navigation);
      }, (file, identity, change) => this.setTopicAppearance(file, identity, change),
      (file, identity, change) => this.setResourceProperties(file, identity, change),
      (target, draft) => this.queueMapWrite(target.mapId, async () => {
        const result = await createResources(this.app, this.index, target, draft,
          (path, content) => this.pendingLocalWrites.expect(path, content));
        this.refreshResourceIndicators(); return result;
      }),
      (file, status, finish) => this.beginResourceMove(leaf, file, status, finish),
      { rename: (map, name) => this.renameMap(map, name), layout: (map, layout) => this.setMapLayout(map, layout),
        center: (map, change) => this.setMapCenter(map, change), icons: (map, key, visible) => this.setMapIcons(map, key, visible),
        duplicate: (map) => this.duplicateMap(map), move: (map) => this.promptMoveMap(map), trash: (map) => this.trashMap(map) }));
    }
    this.syncOpenInMapActions(liveLeaves);
    this.syncReferenceViews();
  }

  private syncOpenInMapActions(liveLeaves?: Set<WorkspaceLeaf>): void {
    const leaves = liveLeaves ?? (() => {
      const result = new Set<WorkspaceLeaf>();
      this.app.workspace.iterateAllLeaves((leaf) => { result.add(leaf); });
      return result;
    })();
    const wanted = new Set<MarkdownView>();
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file || this.integratedPanes.has(leaf) || this.topicPanes.has(leaf)) continue;
      if (!this.noteMapTarget(view.file)) continue;
      wanted.add(view);
      if (this.openInMapActions.has(view)) continue;
      const action = view.addAction("network", "Open in map", () => void this.openNoteInMap(view));
      action.addClass("emberly-open-in-map");
      this.openInMapActions.set(view, action);
    }
    for (const [view, action] of this.openInMapActions) {
      if (wanted.has(view)) continue;
      action.remove();
      this.openInMapActions.delete(view);
    }
  }

  private scheduleAutomaticMapOpen(file: TFile): void {
    if (!isMapNotePath(file.path)) return;
    if (this.autoOpenTimer !== undefined) window.clearTimeout(this.autoOpenTimer);
    this.autoOpenTimer = window.setTimeout(() => {
      this.autoOpenTimer = undefined;
      if (this.stopped) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.file !== file || this.integratedPanes.has(view.leaf)) return;
      const properties = this.index.propertiesFor(file);
      if (properties.emberly !== "map" || properties["emberly-format"] !== 2) return;
      const target = this.noteMapTarget(file);
      if (!target || target.map.path !== file.path) return;
      void this.openNoteInMap(view);
    }, 0);
  }

  private async setResourceProperties(file: TFile, identity: ResourceIdentity, change: ResourceChange): Promise<ResourceSettings> {
    return this.queueMapWrite(identity.mapId, async () => {
      const matches = this.index.sources().filter((source) => {
        const resource = resourceIdentity(source.frontmatter);
        return resource?.id === identity.id && resource.mapId === identity.mapId;
      });
      if (this.index.file(file.path) !== file || matches.length !== 1 || matches[0]!.path !== file.path) {
        throw new Error("The resource is missing or its ID is duplicated. Check its Markdown properties.");
      }
      const saved = await this.updateProperties(file, (properties) => {
        const current = resourceIdentity(properties);
        if (current?.id !== identity.id || current.mapId !== identity.mapId) {
          throw new Error("The resource identity changed while its settings were open.");
        }
        // Apply just this action to the latest metadata; never replace the body
        // or overwrite an intervening tag edit from Obsidian or another pane.
        return resourceProperties(properties, change);
      });
      return readResourceSettings(saved);
    });
  }

  private async setTopicAppearance(file: TFile, identity: TopicIdentity, change: TopicAppearanceChange): Promise<TopicAppearance> {
    return this.queueMapWrite(identity.mapId, async () => {
      const map = this.index.maps().find((candidate) => candidate.id === identity.mapId);
      const node = map?.nodes.find((candidate) => candidate.id === identity.id && candidate.path === file.path);
      if (!map || map.format !== 2 || map.issues.length || !node || this.index.file(file.path) !== file) {
        throw new Error("This topic's map is missing or has hierarchy issues. Reload or repair the topic properties first.");
      }
      if ("color" in change && change.color === -1 && (!node.parentId || map.nodes.some((parent) => parent.id === node.parentId && !parent.parentId))) {
        throw new Error("Root and category topics need their own color.");
      }
      const saved = await this.updateProperties(file, (properties) => {
        // Recheck identity against the current file, not a stale pane or cache.
        if (properties.emberly !== "topic" || properties["emberly-format"] !== 2
          || properties["emberly-id"] !== identity.id || properties["emberly-map"] !== identity.mapId) {
          throw new Error("The topic identity changed while its settings were open.");
        }
        return appearanceProperties(properties, change);
      }, !node.parentId);
      const appearance = readTopicAppearance(saved);
      const applied = "color" in change ? { color: appearance.color } : "rating" in change ? { rating: appearance.rating }
        : { state: (appearance.state & ~4) | (node.state & 4) };
      for (const surface of this.mapSurfaces()) {
        try { surface.applyTopicAppearance(map.path, identity.id, applied); }
        catch (error) {
          console.error("Topic settings saved, but the map could not redraw", error);
          new Notice("Topic settings were saved. Reload the map to update its appearance.");
        }
      }
      return appearance;
    });
  }

  async persistEngineEntity(map: EmberlyMap, snapshot: EngineEntitySnapshot): Promise<void> {
    try {
      await this.queueMapWrite(map.id, () => this.persistParentEntity(map, snapshot));
    } catch (error) {
      new Notice(`Emberly could not save this edit: ${error instanceof Error ? error.message : String(error)}`);
      if (snapshot.changed?.length === 1 && snapshot.changed[0] === "name") {
        const current = this.index.maps().find((candidate) => candidate.id === map.id);
        if (current) for (const surface of this.mapSurfaces()) surface.reconcileIdentity(current);
      } else this.refreshViews(); // Restore failed optimistic structure/appearance edits.
      throw error;
    }
  }

  private mapFileOperations(): MapFileOperations {
    return new MapFileOperations(this.app, this.index, () => {
      if (this.stopped) throw new Error("The plugin has closed. No further files were changed.");
      if (this.moveSession || this.moveBusy || this.pluginData.resourceTransfer) throw new Error("Finish or recover the resource move before duplicating or deleting a map.");
    });
  }

  async duplicateMap(map: EmberlyMap): Promise<void> {
    const operations = this.mapFileOperations();
    const path = await this.queueMapWrite(map.id, async () => operations.duplicate(await operations.snapshot(map.id, true), (path, content) => this.createLocalFile(path, content)));
    const copy = this.index.mapByPath(path);
    if (copy) this.scheduleGraphLinkReconciliation([copy.id]);
    this.refreshResourceIndicators();
    new Notice(`Map duplicated to ${path}.`);
    if (copy && !copy.issues.length) {
      try { await this.openMap(copy); }
      catch { new Notice(`The copy was saved at ${path}. Open it from the map picker once indexing finishes.`, 10000); }
    }
  }

  async trashMap(map: EmberlyMap): Promise<boolean> {
    const operations = this.mapFileOperations();
    const snapshot = await this.queueMapWrite(map.id, () => operations.snapshot(map.id));
    const confirmed = await new Promise<boolean>((resolve) => new TrashMapModal(this.app, snapshot.map, snapshot.notes.map((note) => note.path), resolve).open());
    if (!confirmed) return false;
    try {
      const result = await this.queueMapWrite(map.id, () => operations.trash(snapshot, () => {
        for (const [leaf, pane] of this.integratedPanes) if (pane.surface.mapPath === snapshot.map.path) this.closeIntegratedMap(leaf);
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_EMBERLY_MAP)) {
          if (leaf.view instanceof EmberlyMapView && leaf.view.surface.mapPath === snapshot.map.path) leaf.detach();
        }
      }));
      new Notice(`Moved ${result.notes} map notes and ${result.assets} attachments to trash.${result.kept ? ` Kept ${result.kept} shared or external attachments.` : ""} Restore files from Obsidian’s configured trash if needed.`, 10000);
      return true;
    } finally { this.refreshResourceIndicators(); this.syncTopicPanes(); }
  }

  async setMapIcons(map: EmberlyMap, key: keyof MapIconVisibility, visible: boolean): Promise<void> {
    await this.mapSettings.setIcons(map, key, visible);
  }

  async setMapCenter(map: EmberlyMap, change: MapCenterChange): Promise<void> {
    await this.mapSettings.setCenter(map, change);
  }

  private refreshMapCenters(): void {
    this.mapSettings.refreshAppearance();
  }

  async setMapLayout(map: EmberlyMap, layout: EmberlyLayout): Promise<void> {
    await this.mapSettings.setLayout(map, layout);
  }

  async reconcileMapLayout(mapId: string): Promise<boolean> {
    return this.mapSettings.reconcile(mapId);
  }

  private scheduleLayoutReconciliation(ids: Iterable<string> = []): void {
    this.mapSettings.schedule(ids);
  }

  private graphLinkMapNeedingRepair(file: TFile, properties: Record<string, unknown>): string | undefined {
    return this.graphLinks.mapNeedingRepair(file, properties);
  }

  private scheduleGraphLinkReconciliation(ids?: Iterable<string>): void {
    this.graphLinks.schedule(ids);
  }

  private async reconcileLayoutAfterEdit(mapId: string): Promise<void> {
    try { await this.mapSettings.normalize(mapId); }
    catch (error) {
      // The topic was already saved. Do not offer a duplicate create/move retry.
      new Notice(`Topic saved, but Center layout could not be saved. Reload to retry. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async renameMap(map: EmberlyMap, name: string): Promise<void> {
    await this.queueMapWrite(map.id, async () => {
      const current = this.editableMapSettings(map);
      const file = this.index.file(current.path)!;
      // Validate the requested filename before changing either path.
      const destinationNote = renamedMapPath(current.path, name);
      const folder = this.app.vault.getAbstractFileByPath(current.folder);
      if (!(folder instanceof TFolder) || this.dirname(current.path) !== current.folder) {
        throw new Error("The map note must be directly inside its map folder.");
      }
      const parent = this.dirname(current.folder);
      const destinationFolder = normalizePath([parent, name].filter(Boolean).join("/"));
      const occupiedFolder = this.app.vault.getAbstractFileByPath(destinationFolder);
      if (occupiedFolder && occupiedFolder !== folder) {
        throw new Error("A note or folder already uses that map name. Choose another name.");
      }
      const reservation = destinationFolder.toLowerCase();
      if (destinationFolder !== current.folder && this.mapOperations.destinationReserved(reservation)) {
        throw new Error("Another map is already being renamed to that name.");
      }
      if (destinationFolder !== current.folder) this.mapOperations.reserveDestination(reservation);
      const oldFolder = current.folder, oldPath = file.path;
      let noteRenamed = false;
      try {
        if (file.path !== destinationNote) {
          await this.renameMapNote(file, name);
          noteRenamed = true;
        }
        if (destinationFolder !== oldFolder) {
          await this.app.fileManager.renameFile(folder, destinationFolder);
          this.index.rename(folder.path, oldFolder);
          for (const surface of this.mapSurfaces()) surface.renamePath(oldFolder, folder.path);
          this.syncTopicPanes();
          this.invalidateReferences();
        }
      } catch (error) {
        if (noteRenamed && folder.path === oldFolder) {
          try { await this.renameFile(file, oldPath); }
          catch (rollback) {
            throw new Error(`${error instanceof Error ? error.message : String(error)} The map filename also changed and could not be restored: ${rollback instanceof Error ? rollback.message : String(rollback)}`);
          }
        }
        throw error;
      } finally {
        if (destinationFolder !== oldFolder) this.mapOperations.releaseDestination(reservation);
      }
    });
  }

  promptMoveMap(map: EmberlyMap): void {
    let current: EmberlyMap;
    try { current = this.editableMapSettings(map); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); return; }
    const folder = this.app.vault.getAbstractFileByPath(current.folder);
    if (!(folder instanceof TFolder)) { new Notice("The map folder is missing."); return; }
    new MapFolderPickerModal(this.app, current.folder, (destination) => {
      void this.moveMap(current, destination).catch((error) => {
        console.error("Could not move Emberly map", error);
        new Notice(`Could not move the map: ${error instanceof Error ? error.message : String(error)}`, 10000);
      });
    }).open();
  }

  private async moveMap(map: EmberlyMap, destinationParent: TFolder): Promise<void> {
    await this.queueMapWrite(map.id, async () => {
      const current = this.editableMapSettings(map);
      const folder = this.app.vault.getAbstractFileByPath(current.folder);
      if (!(folder instanceof TFolder) || this.dirname(current.path) !== current.folder) {
        throw new Error("The map note must be directly inside its map folder.");
      }
      const liveDestination = destinationParent.isRoot() ? this.app.vault.getRoot()
        : this.app.vault.getAbstractFileByPath(destinationParent.path);
      if (liveDestination !== destinationParent || !(liveDestination instanceof TFolder)) {
        throw new Error("The destination folder moved or is no longer available. Choose it again.");
      }
      const parent = destinationParent.isRoot() ? "" : destinationParent.path;
      if (parent === this.dirname(current.folder)) throw new Error("This map is already in that folder.");
      if (parent === current.folder || parent.startsWith(`${current.folder}/`)) {
        throw new Error("A map cannot be moved inside its own folder.");
      }
      const folderName = current.folder.split("/").at(-1);
      if (!folderName) throw new Error("The map folder name is invalid.");
      const destination = normalizePath([parent, folderName].filter(Boolean).join("/"));
      const occupied = this.app.vault.getAbstractFileByPath(destination);
      if (occupied && occupied !== folder) throw new Error(`“${destination}” already exists. Choose another destination.`);
      const reservation = destination.toLowerCase();
      if (this.mapOperations.destinationReserved(reservation)) throw new Error("Another map operation is already using that destination.");
      this.mapOperations.reserveDestination(reservation);
      const oldFolder = current.folder;
      try {
        await this.app.fileManager.renameFile(folder, destination);
        this.index.rename(folder.path, oldFolder);
        for (const surface of this.mapSurfaces()) surface.renamePath(oldFolder, folder.path);
        this.syncTopicPanes();
        this.invalidateReferences();
        new Notice(`Moved “${current.title}” to ${parent || "the vault root"}.`);
      } finally { this.mapOperations.releaseDestination(reservation); }
    });
  }

  private editableMapSettings(map: EmberlyMap): EmberlyMap {
    return this.mapSettings.editable(map);
  }

  chooseMap(separate = false): void {
    const maps = this.index.maps();
    new MapPickerModal(this.app, maps, (map) => void this.openMap(map, separate), (name) => {
      if (name) void this.createAndOpenMap(name, separate);
      else this.promptForMap(separate);
    }).open();
  }

  promptForMap(separate = false): void {
    new NameModal(this.app, "Create Emberly map", "My map", async (name) => {
      await this.createAndOpenMap(name, separate);
    }).open();
  }

  private async createAndOpenMap(name: string, separate = false): Promise<void> {
    try {
      const map = await this.createMap(name);
      await this.openMap(map, separate);
    } catch (error) {
      console.error("Could not create Emberly map", error);
      new Notice(`Could not open the new map: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  promptForTopic(map: EmberlyMap, topicId: string | null, asSibling = false): void {
    const current = this.index.maps().find((candidate) => candidate.id === map.id);
    if (!current || current.issues.length || current.format !== 2) {
      new Notice("Resolve the map hierarchy before adding topics."); return;
    }
    const selected = topicId ? current.nodes.find((node) => node.id === topicId) : undefined;
    if (topicId && !selected) { new Notice("The selected topic is no longer available."); return; }
    if (asSibling && !selected?.parentId) {
      new Notice("Select an existing non-root topic to add a sibling."); return;
    }
    const parent = asSibling ? current.nodes.find((node) => node.id === selected!.parentId)
      : selected ?? current.nodes.find((node) => !node.parentId);
    if (!parent) { new Notice("Select an existing parent topic."); return; }
    const side = asSibling ? selected!.side : undefined;
    new TopicNamesModal(this.app, asSibling ? `Add siblings of ${selected!.title}` : `Add topics below ${parent.title}`, async (name) => {
      // A write failure stays in the batch dialog for retry. Once the file is
      // saved, a delayed UI/index refresh must never offer to create it twice.
      const file = await this.createTopic(current, name, parent.id, side);
      try {
        await this.waitForMetadata(file.path);
        const latestPath = this.index.maps().find((map) => map.id === current.id)?.path ?? current.path;
        const indexed = await this.waitForIndexedTopic(latestPath, file.path);
        if (!indexed) throw new Error(`Could not index created topic ${file.path}`);
        this.addTopicToViews(indexed.map, indexed.node);
      } catch (error) {
        console.error("Emberly topic saved, but map refresh was delayed", error);
        new Notice(`“${file.basename}” was saved. Reload the map if it does not appear yet.`);
      }
    }).open();
  }

  private async createMap(name: string): Promise<EmberlyMap> {
    const safeName = this.safeSegment(name);
    const folder = await this.uniqueFolder(normalizePath(`${MAPS_FOLDER}/${safeName}`));
    await this.ensureFolder(folder);
    const mapId = this.index.allocateId();
    const rootId = this.index.allocateId();
    const folderName = folder.split("/").at(-1)!;
    const mapPath = normalizePath(`${folder}/${mapNoteFilename(folderName)}`);
    await this.createLocalFile(mapPath, this.frontmatter({ emberly: "map", "emberly-format": 2, "emberly-id": mapId, "emberly-root-id": rootId, "emberly-layout": "center" }));
    // The map document is also the root note. Wait until MetadataCache exposes
    // the synthesized root before opening the canvas.
    const indexed = await this.waitForIndexedTopic(mapPath, mapPath);
    if (!indexed) throw new Error("The map was saved, but it is not indexed yet. Open it again once Obsidian finishes indexing.");
    return indexed.map;
  }

  private async createTopic(map: EmberlyMap, name: string, parentId: string | null, forcedSide?: "left" | "right" | "center"): Promise<TFile> {
    return this.queueMapWrite(map.id, async () => {
      const file = await this.createParentTopic(map, name, parentId, forcedSide);
      await this.reconcileLayoutAfterEdit(map.id);
      return file;
    });
  }

  private frontmatter(values: Record<string, string | number | boolean>): string {
    const lines = Object.entries(values).map(([key, value]) => `${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`);
    return `---\n${lines.join("\n")}\n---\n\n`;
  }
  private sideName(side: number): "left" | "right" | "center" { return side < 0 ? "left" : side > 0 ? "right" : "center"; }
  private safeSegment(name: string): string { return safeName(name.trim() || "Untitled map"); }
  private dirname(path: string): string { return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""; }
  private async persistMapLayout(map: EmberlyMap, layout: EmberlyLayout): Promise<void> {
    await this.mapSettings.persistLayout(map, layout);
  }
  private async uniqueFolder(base: string): Promise<string> {
    let candidate = base; let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) candidate = `${base} (${suffix++})`;
    return candidate;
  }
  private async ensureFolder(path: string): Promise<void> {
    const pieces = path.split("/"); let current = "";
    for (const piece of pieces) {
      current = normalizePath(current ? `${current}/${piece}` : piece);
      if (!this.app.vault.getAbstractFileByPath(current)) {
        this.pendingLocalWrites.mark(current);
        await this.app.vault.createFolder(current);
      }
    }
  }
  private async createLocalFile(path: string, contents: string): Promise<TFile> {
    this.pendingLocalWrites.expect(path, contents);
    const file = await this.app.vault.create(path, contents);
    this.index.setContent(file.path, contents);
    return file;
  }

  private queueMapWrite<T>(mapId: string, action: () => Promise<T>): Promise<T> {
    return this.mapOperations.run(mapId, action);
  }

  private queueMapsWrite<T>(ids: string[], action: () => Promise<T>): Promise<T> {
    return this.mapOperations.runMany(ids, action);
  }
  private refreshResourceIndicators(): void {
    this.invalidateReferences();
    if (this.resourceRefreshTimer !== undefined) return;
    this.resourceRefreshTimer = window.setTimeout(() => {
      this.resourceRefreshTimer = undefined;
      const maps = this.index.maps();
      for (const surface of this.mapSurfaces()) surface.reconcileResources(maps);
      this.syncTopicPanes();
    }, 80);
  }
  private resourceMoves(): ResourceMoves {
    return new ResourceMoves(this.app, this.index, async (plan) => {
      const next = { ...this.pluginData };
      if (plan) next.resourceTransfer = plan;
      else delete next.resourceTransfer;
      await this.saveData(next); this.pluginData = next;
    }, (path, content) => this.pendingLocalWrites.expect(path, content));
  }
  private updateMoveViews(): void {
    for (const surface of this.mapSurfaces()) surface.setResourceMoveActive(this.resourceMoveActive);
    this.syncReferenceViews();
  }
  selectResourceMoveTarget(mapId: string, topicId: string): boolean {
    if (!this.moveSession) return false;
    this.moveSession.choose(mapId, topicId); return true;
  }
  private beginResourceMove(leaf: WorkspaceLeaf, file: TFile, status: (busy: boolean, message: string) => void, finish: () => void): ResourceMoveSession {
    if (this.moveBusy) throw new Error("A resource move is already saving.");
    if (this.pluginData.resourceTransfer) throw new Error("Recover or cancel the pending resource move first.");
    this.moveSession?.cancel();
    const resource = this.index.resourceCatalog().resources.find((resource) => resource.path === file.path);
    if (!resource) throw new Error("This resource has invalid ownership. Check its note Details.");
    const mapLeaf = [...this.topicLeaves].find(([, topicLeaf]) => topicLeaf === leaf)?.[0];
    const session: ResourceMoveSession = {
      cancel: () => {
        if (this.moveSession !== session) return;
        this.moveSession = undefined; this.updateMoveViews(); finish();
      },
      choose: (mapId, topicId) => {
        if (this.moveSession !== session || this.moveBusy) return;
        const node = this.index.maps().find((map) => map.id === mapId)?.nodes.find((node) => node.id === topicId);
        const targetFile = node && this.index.file(node.path);
        if (!node || !targetFile) { status(false, "This destination is no longer available."); return; }
        if (!node.parentId) { status(false, "The map root cannot own resources. Choose a non-root topic."); return; }
        this.moveBusy = true; status(true, "Moving resource…");
        void this.queueMapsWrite([resource.mapId, mapId], async () => {
          // Use the public native-editor save before reading a move snapshot.
          // Never replace a live editor or manipulate CodeMirror internals.
          if (leaf.view instanceof MarkdownView && leaf.view.file === file) await leaf.view.save();
          return this.resourceMoves().move(resource, { file: targetFile, id: node.id, mapId });
        })
          .then(async (result) => {
            this.refreshResourceIndicators();
            new Notice(result.kept.length ? `Resource moved. Retained ${result.kept.length} original attachment(s) because they may still be used.` : "Resource moved. Any verified unused originals were sent to Obsidian's configured trash.", 7000);
            const stillHere = this.moveSession === session;
            session.cancel();
            const source = this.index.maps().find((map) => map.id === resource.mapId)?.nodes.find((node) => node.id === resource.topicId);
            if (stillHere && source && mapLeaf && this.workspaceContainsLeaf(mapLeaf)) {
              try { await this.openTopicFile(source.path, mapLeaf, false, { section: "resources" }); }
              catch { new Notice("The resource was moved, but its source topic could not be opened."); }
            }
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            status(false, message);
            new Notice(`Move not completed: ${message}${this.pluginData.resourceTransfer ? " Run Recover pending resource move before moving another resource." : ""}`, 12000);
            if (this.pluginData.resourceTransfer) session.cancel();
          }).finally(() => { this.moveBusy = false; this.refreshResourceIndicators(); });
      },
    };
    this.moveSession = session; this.updateMoveViews();
    return session;
  }
  private async recoverResourceMove(): Promise<void> {
    if (this.moveBusy) { new Notice("Wait for the current resource move to finish."); return; }
    if (!this.pluginData.resourceTransfer) { new Notice("No pending resource move."); return; }
    this.moveBusy = true;
    try {
      const plan = validateTransfer(this.pluginData.resourceTransfer);
      const mapIds = [plan.before, plan.after].map((content) => {
        const mapId = frontmatter(content).properties["emberly-map"];
        return typeof mapId === "string" ? mapId : "";
      });
      const result = await this.queueMapsWrite(mapIds, () => this.resourceMoves().recover(plan));
      new Notice(`Resource move recovered: ${result.path}. ${result.kept.length} possible shared originals retained. Unused originals go to configured trash.`, 12000);
    } catch (error) { new Notice(`Recovery paused: ${error instanceof Error ? error.message : String(error)} No unverified originals were deleted.`, 15000); }
    finally { this.moveBusy = false; this.refreshResourceIndicators(); }
  }
  private async cancelPendingTransfer(): Promise<void> {
    if (this.moveBusy) { new Notice("Wait for the resource move to finish."); return; }
    if (!this.pluginData.resourceTransfer) { new Notice("No pending resource move."); return; }
    this.moveBusy = true;
    try {
      const plan = validateTransfer(this.pluginData.resourceTransfer), source = this.index.file(plan.source);
      if (!source || await this.app.vault.read(source) !== plan.before || this.app.vault.getAbstractFileByPath(plan.destination)) {
        throw new Error("Ownership was already changed or the resource was edited. Recover the move instead.");
      }
      const next = { ...this.pluginData }; delete next.resourceTransfer;
      await this.saveData(next); this.pluginData = next;
      new Notice(`Pending move cancelled. The resource is unchanged. Copied files were kept for manual review in ${plan.destinationAssets}.`, 12000);
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 12000); }
    finally { this.moveBusy = false; }
  }

  private currentEditableMap(map: EmberlyMap): EmberlyMap {
    const current = this.index.maps().find((candidate) => candidate.id === map.id);
    if (!current || current.format !== 2 || current.issues.length) throw new Error(current?.issues.join(" ") || "The map is unavailable.");
    return current;
  }

  private async renameNote(file: TFile, name: string): Promise<void> {
    await this.renameFile(file, renamedNotePath(file.path, name));
  }

  private async renameMapNote(file: TFile, name: string): Promise<void> {
    await this.renameFile(file, renamedMapPath(file.path, name));
  }

  private async renameFile(file: TFile, destination: string): Promise<void> {
    if (destination === file.path) return;
    const key = destination.toLowerCase();
    const occupied = this.app.vault.getAbstractFileByPath(destination);
    if ((occupied && occupied !== file) || this.mapOperations.destinationReserved(key)) {
      throw new Error("A note or folder already uses that filename. Choose another name.");
    }
    this.mapOperations.reserveDestination(key);
    const oldPath = file.path;
    // Remember the identity before MetadataCache temporarily loses the old path.
    this.index.propertiesFor(file);
    try {
      await this.app.fileManager.renameFile(file, destination);
      this.index.rename(file.path, oldPath);
      for (const surface of this.mapSurfaces()) surface.renamePath(oldPath, file.path);
      this.syncTopicPanes();
      this.invalidateReferences();
    } finally { this.mapOperations.releaseDestination(key); }
  }

  /** Refresh the affected parent chain/neighbours before validating a drag.
   * No full-vault reads, and the source is checked again inside Vault.process. */
  private async refreshHierarchyForMove(map: EmberlyMap, snapshot: EngineEntitySnapshot): Promise<void> {
    const current = this.currentEditableMap(map);
    const mapFile = this.index.file(current.path);
    if (!mapFile) throw new Error("The map note is missing.");
    this.index.setContent(mapFile.path, await this.app.vault.read(mapFile));
    const queue = [snapshot.id, snapshot.parentId, snapshot.previousSiblingId, snapshot.nextSiblingId];
    const visited = new Set<string>();
    while (queue.length) {
      const id = queue.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const node = this.index.maps().find((candidate) => candidate.id === map.id)?.nodes.find((candidate) => candidate.id === id);
      const file = node && this.index.file(node.path);
      if (!file) throw new Error("A topic in this move is missing.");
      this.index.setContent(file.path, await this.app.vault.read(file));
      const fm = this.index.propertiesFor(file);
      if (!node.parentId && node.path === current.path) {
        if (fm.emberly !== "map" || fm["emberly-format"] !== 2 || fm["emberly-id"] !== map.id
          || fm["emberly-root-id"] !== node.id) throw new Error("The map root identity changed during the move.");
        continue;
      }
      if (fm["emberly-id"] !== id || fm["emberly-map"] !== map.id || fm["emberly-format"] !== 2 || fm.emberly !== "topic") {
        throw new Error("A topic's identity changed during the move.");
      }
      if (typeof fm["emberly-parent"] === "string") queue.push(fm["emberly-parent"]);
    }
  }

  private async persistParentEntity(map: EmberlyMap, snapshot: EngineEntitySnapshot): Promise<void> {
    const moving = !snapshot.changed || snapshot.changed.includes("parentId") || snapshot.changed.includes("index");
    if (moving) await this.refreshHierarchyForMove(map, snapshot);
    const current = this.currentEditableMap(map);
    const node = current.nodes.find((candidate) => candidate.id === snapshot.id);
    const file = node ? this.index.file(node.path) : undefined;
    if (!node || !file) throw new Error("This topic is no longer in the map.");
    const changed = snapshot.changed ?? ["parentId", "index", "name", "side", "color", "isCollapsed", "rating", "state"];
    if (!node.parentId && node.path === current.path) {
      if (snapshot.parentId) throw new Error("The map root cannot be moved under another topic.");
      if (changed.includes("name")) await this.renameNote(file, snapshot.name);
      if (changed.includes("side")) await this.persistMapLayout(current, snapshot.side === 0 ? "center" : "branch");
      return;
    }
    if (changed.includes("name")) await this.renameNote(file, snapshot.name);
    const updates: Record<string, unknown> = {};
    if (changed.includes("side")) updates["emberly-side"] = this.sideName(snapshot.side);
    if (changed.includes("color")) updates["emberly-color"] = snapshot.color;
    if (changed.includes("isCollapsed")) updates["emberly-collapsed"] = snapshot.isCollapsed;
    if (changed.includes("rating")) updates["emberly-rating"] = snapshot.rating;
    if (changed.includes("state")) updates["emberly-state"] = snapshot.state & ~4;
    if (moving && snapshot.previousIndex !== undefined && snapshot.previousIndex !== node.order) {
      throw new Error("The topic's order changed. Try the move again.");
    }
    if (moving) {
      Object.assign(updates, topicMoveProperties(this.currentEditableMap(map), snapshot));
      const moved = this.currentEditableMap(map), parentId = updates["emberly-parent"];
      const parent = typeof parentId === "string" ? moved.nodes.find((candidate) => candidate.id === parentId) : undefined;
      const parentFile = parent && this.index.file(parent.path);
      if (!parentFile) throw new Error("The destination parent note is missing.");
      updates[TOPIC_PARENT_LINK_PROPERTY] = topicParentLink(this.app.metadataCache, file.path, parentFile);
    }
    if (Object.keys(updates).length) await this.updateProperties(file, (properties) => {
      if (properties.emberly !== "topic" || properties["emberly-format"] !== 2
        || properties["emberly-id"] !== node.id || properties["emberly-map"] !== current.id) {
        throw new Error("The topic identity changed. Select it again.");
      }
      if (moving && (properties["emberly-parent"] !== node.parentId
        || properties["emberly-order"] !== node.order)) {
        throw new Error("The topic was moved or reordered outside this view. Reload before retrying.");
      }
      return updates;
    }, !snapshot.parentId);
    if (!snapshot.parentId && changed.includes("side")) await this.persistMapLayout(current, snapshot.side === 0 ? "center" : "branch");
    if (moving) await this.reconcileLayoutAfterEdit(current.id);
  }

  private updateProperties(file: TFile, update: PropertyUpdate, root = false): Promise<Record<string, unknown>> {
    return this.frontmatterEditor.update(file, update, root);
  }

  private async createParentTopic(map: EmberlyMap, name: string, parentId: string | null, forcedSide?: "left" | "right" | "center"): Promise<TFile> {
    const current = this.currentEditableMap(map);
    const parent = current.nodes.find((node) => node.id === parentId);
    if (!parent) throw new Error("Select an existing parent topic.");
    const id = this.index.allocateId();
    const side = forcedSide ?? (parent?.side === "left" ? "left" : "right");
    const folder = normalizePath(`${current.folder}/Topics`);
    await this.ensureFolder(folder);
    const base = normalizePath(`${folder}/${this.safeSegment(name)}`);
    let path = `${base}.md`; let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = `${base} (${suffix++}).md`;
    const parentFile = this.index.file(parent.path);
    if (!parentFile) throw new Error("The parent topic note is missing.");
    const properties: Record<string, string | number | boolean> = {
      emberly: "topic", "emberly-format": 2, "emberly-id": id, "emberly-map": current.id,
      "emberly-parent": parentId!, "emberly-order": appendTopicOrder(this.currentEditableMap(map), parentId!),
      [TOPIC_PARENT_LINK_PROPERTY]: topicParentLink(this.app.metadataCache, path, parentFile),
      ...(side === "left" ? { "emberly-side": side } : {}),
    };
    const file = await this.createLocalFile(path, this.frontmatter(properties));
    return file;
  }
  private async waitForMetadata(path: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && this.app.metadataCache.getFileCache(file)?.frontmatter) return;
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
  }
  private async waitForIndexedTopic(mapPath: string, topicPath: string): Promise<{ map: EmberlyMap; node: EmberlyNode } | undefined> {
    for (let attempt = 0; attempt < 80; attempt++) {
      const map = this.index.mapByPath(mapPath);
      const node = map?.nodes.find((candidate) => candidate.path === topicPath);
      if (map && node && !map.issues.length) return { map, node };
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    return undefined;
  }
  private addTopicToViews(map: EmberlyMap, node: EmberlyNode): void {
    for (const surface of this.mapSurfaces()) surface.addTopic(map.path, node);
  }
  private workspaceContainsLeaf(expected: WorkspaceLeaf): boolean {
    let found = false;
    this.app.workspace.iterateAllLeaves((leaf) => { if (leaf === expected) found = true; });
    return found;
  }
  private refreshViews(change?: MapFileChange): void {
    if (change && !change.appearanceOnly) {
      this.scheduleLayoutReconciliation([change.before, change.after].flatMap((source) => source ? [source.kind === "map" ? source.id : source.mapId] : []));
    } else if (!change) this.scheduleLayoutReconciliation();
    if (change) this.pendingMapChanges.push(change);
    else this.forceMapRefresh = true;
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      const force = this.forceMapRefresh;
      const changes = this.pendingMapChanges;
      this.forceMapRefresh = false;
      this.pendingMapChanges = [];
      const maps = force ? [] : this.index.maps();
      for (const surface of this.mapSurfaces()) {
        if (force) surface.refresh();
        else surface.refreshChanged(maps, changes);
      }
    }, 150);
  }
}
