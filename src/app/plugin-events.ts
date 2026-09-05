import { MarkdownView, Plugin, TFile } from "obsidian";
import type { EmberlyMapSurface } from "../maps/map-surface";
import type { EmberlyVaultIndex } from "../vault/vault-index";
import type { LocalWriteGuard } from "../vault/local-write-guard";
import type { MapFileChange, MapFileChanges } from "../maps/map-file-changes";
import { resourceMembershipSignature } from "../resources/resource-catalog";

export interface PluginEventHost {
  plugin: Plugin;
  index: EmberlyVaultIndex;
  localWrites: LocalWriteGuard;
  mapFileChanges: MapFileChanges;
  stopped(): boolean;
  pendingTransfer(): boolean;
  notifyPendingTransfer(): void;
  mapSurfaces(): EmberlyMapSurface[];
  invalidateReferences(): void;
  scheduleReferences(path?: string): void;
  syncTopicPanes(): void;
  refreshResourceIndicators(): void;
  refreshMapCenters(): void;
  refreshViews(change?: MapFileChange): void;
  graphLinkMapNeedingRepair(file: TFile, properties: Record<string, unknown>): string | undefined;
  scheduleGraphLinkReconciliation(ids?: Iterable<string>): void;
  scheduleLayoutReconciliation(): void;
  scheduleAutomaticMapOpen(file: TFile): void;
  retryUnresolvedReferences(): void;
  updatePanePresentation(view: MarkdownView): void;
}

/**
 * Owns external Obsidian event registration and startup sequencing. Keeping this
 * at the boundary makes main.ts orchestration independent from event bookkeeping.
 */
export function registerPluginEvents(host: PluginEventHost): void {
  const { plugin, index, mapFileChanges } = host;
  const signatures = new Map<string, string>();
  const refresh = () => host.refreshViews();
  let workspaceReady = false;

  plugin.registerEvent(plugin.app.metadataCache.on("changed", (file, data, cache) => index.withSnapshot(() => {
    if (index.isMapAsset(file.path)) return;
    index.setContent(file.path, data);
    index.metadataObserved(file.path, data);
    const signature = resourceMembershipSignature(cache.frontmatter ?? {});
    if ((signatures.get(file.path) ?? "") !== signature) host.refreshResourceIndicators();
    signatures.set(file.path, signature);
    host.scheduleReferences(file.path);
    host.syncTopicPanes();
    // Always advance the baseline, including local writes. A later native
    // autosave must not rediscover a map edit already applied in place.
    const change = mapFileChanges.record({ path: file.path, basename: file.basename, frontmatter: cache.frontmatter ?? {}, content: data });
    if (change && !change.appearanceOnly) host.invalidateReferences();
    const graphLinkMap = host.graphLinkMapNeedingRepair(file, cache.frontmatter ?? {});
    if (graphLinkMap) host.scheduleGraphLinkReconciliation([graphLinkMap]);
    if (host.localWrites.matches(file.path, data, index.propertiesFor(file))) {
      if (change?.appearanceOnly) host.refreshViews(change);
      return;
    }
    if (change) host.refreshViews(change);
  })));

  plugin.registerEvent(plugin.app.vault.on("modify", (file) => {
    index.metadataPending(file.path);
    if (file instanceof TFile && file.extension !== "md") host.refreshMapCenters();
  }));
  plugin.registerEvent(plugin.app.vault.on("delete", (file) => {
    host.invalidateReferences();
    index.remove(file.path);
    host.syncTopicPanes();
    for (const path of signatures.keys()) {
      if (path !== file.path && !path.startsWith(`${file.path}/`)) continue;
      if (signatures.get(path)) host.refreshResourceIndicators();
      signatures.delete(path);
    }
    for (const change of mapFileChanges.remove(file.path)) host.refreshViews(change);
    host.refreshMapCenters();
  }));
  plugin.registerEvent(plugin.app.vault.on("rename", (file, oldPath) => {
    host.invalidateReferences();
    index.rename(file.path, oldPath);
    for (const surface of host.mapSurfaces()) surface.renamePath(oldPath, file.path);
    host.syncTopicPanes();
    host.refreshResourceIndicators();
    for (const change of mapFileChanges.remove(oldPath)) host.refreshViews(change);
    for (const source of index.sources()) {
      if (source.path !== file.path && !source.path.startsWith(`${file.path}/`)) continue;
      const change = mapFileChanges.record(source);
      if (change) host.refreshViews(change);
    }
    host.scheduleGraphLinkReconciliation();
  }));

  plugin.registerEvent(plugin.app.workspace.on("css-change", refresh));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", () => host.syncTopicPanes()));
  plugin.registerEvent(plugin.app.workspace.on("file-open", (file) => {
    host.syncTopicPanes();
    if (file instanceof TFile) host.scheduleAutomaticMapOpen(file);
  }));
  plugin.registerEvent(plugin.app.workspace.on("editor-change", (_editor, info) => {
    if (info instanceof MarkdownView) host.updatePanePresentation(info);
  }));
  plugin.registerEvent(plugin.app.metadataCache.on("resolve", (file) => host.scheduleReferences(file.path)));
  plugin.registerEvent(plugin.app.metadataCache.on("resolved", () => {
    if (!workspaceReady) return;
    void index.initialize().then((added) => {
      if (host.stopped()) return;
      if (added) {
        mapFileChanges.reset(index.sources());
        refresh();
      }
      host.syncTopicPanes();
      host.scheduleLayoutReconciliation();
      host.scheduleGraphLinkReconciliation();
      host.refreshMapCenters();
      host.retryUnresolvedReferences();
    }).catch((error: unknown) => console.error("Could not initialize map metadata", error));
  }));

  plugin.app.workspace.onLayoutReady(() => {
    workspaceReady = true;
    mapFileChanges.reset(index.sources());
    for (const source of index.sources()) signatures.set(source.path, resourceMembershipSignature(source.frontmatter));
    // Vault initialization emits create for existing files. Register only after
    // the workspace has finished loading to avoid a full-vault startup storm.
    plugin.registerEvent(plugin.app.vault.on("create", (file) => {
      host.invalidateReferences();
      if (file instanceof TFile && file.extension !== "md") host.refreshMapCenters();
    }));
    if (host.pendingTransfer()) {
      host.notifyPendingTransfer();
    }
    void index.initialize().then(() => {
      if (host.stopped()) return;
      mapFileChanges.reset(index.sources());
      refresh();
      host.syncTopicPanes();
      host.scheduleReferences();
      host.scheduleGraphLinkReconciliation();
    }).catch((error: unknown) => console.error("Could not initialize map metadata", error));
  });
}
