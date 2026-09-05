import { Notice, TFile, type App } from "obsidian";
import type { MapCenterChange } from "./map-center";
import { prepareCenterImage } from "./map-center-image";
import { BRANCH_LAYOUT_REQUIREMENT, canUseBranchLayout, needsCenterLayout } from "./map-layout";
import type { EmberlyMapSurface } from "./map-surface";
import { createUnique, ensureFolder } from "../vault/vault-files";
import type { EmberlyLayout, EmberlyMap, MapIconVisibility } from "../shared/types";
import type { EmberlyVaultIndex } from "../vault/vault-index";
import type { PropertyUpdate } from "../vault/frontmatter-editor";

interface MapSettingsHost {
  app: App;
  index(): EmberlyVaultIndex;
  stopped(): boolean;
  queueWrite<T>(mapId: string, action: () => Promise<T>): Promise<T>;
  updateProperties(file: TFile, update: PropertyUpdate): Promise<Record<string, unknown>>;
  surfaces(): EmberlyMapSurface[];
  syncTopicPanes(): void;
}

/** Owns map-level appearance, layout eligibility, and delayed reconciliation. */
export class MapSettingsController {
  private layoutReconcileTimer?: number;
  private readonly pendingLayoutMaps = new Set<string>();

  constructor(private readonly host: MapSettingsHost) {}

  dispose(): void {
    if (this.layoutReconcileTimer !== undefined) window.clearTimeout(this.layoutReconcileTimer);
    this.layoutReconcileTimer = undefined;
    this.pendingLayoutMaps.clear();
  }

  editable(map: EmberlyMap): EmberlyMap {
    const index = this.host.index();
    const matches = index.maps().filter((candidate) => candidate.id === map.id);
    const current = matches[0];
    if (matches.length !== 1 || !current || current.issues.length || current.format !== 2
      || !index.file(current.path) || current.nodes.filter((node) => !node.parentId).length !== 1) {
      throw new Error("The map is missing or has hierarchy issues. Check its Markdown properties.");
    }
    return current;
  }

  async setIcons(map: EmberlyMap, key: keyof MapIconVisibility, visible: boolean): Promise<void> {
    if (!["notes", "resources"].includes(key) || typeof visible !== "boolean") throw new Error("Invalid icon setting.");
    await this.host.queueWrite(map.id, async () => {
      const current = this.editable(map), file = this.host.index().file(current.path)!;
      if (current.format !== 2) throw new Error("Icon settings require a format-2 map.");
      await this.host.updateProperties(file, (properties) => {
        if (properties.emberly !== "map" || properties["emberly-format"] !== 2 || properties["emberly-id"] !== current.id) {
          throw new Error("The map identity changed. Reopen its settings.");
        }
        return { [`emberly-show-${key}`]: visible ? undefined : false };
      });
      this.refreshAppearance();
    });
  }

  async setCenter(map: EmberlyMap, change: MapCenterChange): Promise<void> {
    await this.host.queueWrite(map.id, async () => {
      if (!["avatar", "text", "image"].includes(change.mode)) throw new Error("Invalid center appearance.");
      const current = this.editable(map);
      if (current.format !== 2) throw new Error("Center appearance requires a format-2 map.");
      const index = this.host.index(), file = index.file(current.path)!;
      const mapPath = file.path;
      const assertCurrent = () => {
        if (this.host.stopped()) throw new Error("The plugin was closed before the center could be saved.");
        const latest = this.editable(current);
        if (latest.layout !== "center") throw new Error("Center appearance is available in Center layout only.");
        if (latest.path !== mapPath || file.path !== mapPath || this.host.index().file(mapPath) !== file) {
          throw new Error("The map moved. Reopen its settings and try again.");
        }
      };
      assertCurrent();
      let uploaded: TFile | undefined;
      try {
        const updates: Record<string, unknown> = {
          "emberly-center": change.mode === "avatar" ? undefined : change.mode,
          "emberly-center-text": undefined,
          "emberly-center-image": undefined,
        };
        if (change.mode === "text") {
          const text = change.text.trim();
          if (text.length > 500) throw new Error("Keep the center text within 500 characters.");
          updates["emberly-center-text"] = text || undefined;
        } else if (change.mode === "image") {
          const image = await prepareCenterImage(change.file);
          assertCurrent();
          const folder = [current.folder, "Assets"].filter(Boolean).join("/");
          await ensureFolder(this.host.app, folder);
          assertCurrent();
          uploaded = await createUnique(this.host.app, folder, image.stem, image.extension,
            (path) => this.host.app.vault.createBinary(path, image.bytes));
          updates["emberly-center-image"] = `[[${uploaded.path}]]`;
        }
        assertCurrent();
        await this.host.updateProperties(file, (properties) => {
          assertCurrent();
          if (properties.emberly !== "map" || properties["emberly-id"] !== current.id
            || properties["emberly-format"] !== current.format || properties["emberly-layout"] !== "center"
            || properties["emberly-root-id"] !== current.nodes.find((node) => !node.parentId)?.id) {
            throw new Error("The map settings changed before the center could be saved. Reopen them and try again.");
          }
          if (uploaded) updates["emberly-center-image"] = `[[${uploaded.path}]]`;
          return updates;
        });
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}${uploaded ? ` Uploaded image kept at ${uploaded.path}.` : ""}`);
      }
      this.refreshAppearance();
    });
  }

  /** Appearance and attachment changes reuse the canvas, selection and viewport. */
  refreshAppearance(): void {
    if (this.host.stopped()) return;
    const maps = this.host.index().maps();
    for (const surface of this.host.surfaces()) {
      const map = maps.find((candidate) => candidate.path === surface.mapPath);
      if (map && !map.issues.length) surface.reconcileIdentity(map);
    }
    this.host.syncTopicPanes();
  }

  async setLayout(map: EmberlyMap, layout: EmberlyLayout): Promise<void> {
    if (layout !== "center" && layout !== "branch") throw new Error("Invalid map layout.");
    await this.host.queueWrite(map.id, async () => {
      const current = this.editable(map), index = this.host.index();
      if (layout === "branch" && !canUseBranchLayout(current)) throw new Error(BRANCH_LAYOUT_REQUIREMENT);
      if (!index.hierarchySettled(current.id)) throw new Error("Wait for Obsidian to finish indexing the map, then try again.");
      if (current.layout === layout) return;
      const file = index.file(current.path)!;
      await this.host.updateProperties(file, (properties) => {
        if (properties.emberly !== "map" || properties["emberly-format"] !== 2 || properties["emberly-id"] !== current.id) {
          throw new Error("The map identity changed while settings were open.");
        }
        if (properties["emberly-root-id"] !== current.nodes.find((node) => !node.parentId)?.id) throw new Error("The map root changed. Reopen its settings.");
        if (layout === "branch" && !canUseBranchLayout(this.editable(current))) throw new Error(BRANCH_LAYOUT_REQUIREMENT);
        return { "emberly-layout": layout };
      });
      this.refreshLayoutViews(current.id);
    });
  }

  async persistLayout(map: EmberlyMap, layout: EmberlyLayout): Promise<void> {
    const index = this.host.index();
    const current = index.maps().find((candidate) => candidate.id === map.id);
    if (layout === "branch" && (!current || !canUseBranchLayout(current))) throw new Error(BRANCH_LAYOUT_REQUIREMENT);
    const file = index.file(current?.path ?? map.path);
    if (file) await this.host.updateProperties(file, { "emberly-layout": layout });
  }

  reconcile(mapId: string): Promise<boolean> {
    return this.host.queueWrite(mapId, () => this.normalize(mapId));
  }

  /** Called inside the map write queue. Never repairs invalid hierarchy. */
  async normalize(mapId: string): Promise<boolean> {
    if (this.host.stopped()) return false;
    const index = this.host.index(), map = index.maps().find((candidate) => candidate.id === mapId);
    if (!map || !needsCenterLayout(map)) {
      this.pendingLayoutMaps.delete(mapId);
      return false;
    }
    if (!index.hierarchySettled(mapId)) {
      this.pendingLayoutMaps.add(mapId);
      return false;
    }
    const file = index.file(map.path);
    if (!file) return false;
    let changed = false;
    await this.host.updateProperties(file, (properties) => {
      if (this.host.stopped()) throw new Error("The plugin was closed before layout could be saved.");
      const latest = this.host.index().maps().find((candidate) => candidate.id === mapId);
      if (!latest || !needsCenterLayout(latest) || !this.host.index().hierarchySettled(mapId)) return {};
      if (properties.emberly !== "map" || properties["emberly-format"] !== 2 || properties["emberly-id"] !== mapId
        || properties["emberly-root-id"] !== latest.nodes.find((node) => !node.parentId)?.id) {
        throw new Error("The map identity changed before its layout could be saved.");
      }
      changed = true;
      return { "emberly-layout": "center" };
    });
    if (changed && !this.host.stopped()) {
      this.pendingLayoutMaps.delete(mapId);
      this.refreshLayoutViews(mapId);
    }
    return changed;
  }

  schedule(ids: Iterable<string> = []): void {
    if (this.host.stopped()) return;
    for (const id of ids) if (id) this.pendingLayoutMaps.add(id);
    for (const surface of this.host.surfaces()) {
      const map = this.host.index().mapByPath(surface.mapPath);
      if (map && needsCenterLayout(map)) this.pendingLayoutMaps.add(map.id);
    }
    if (!this.pendingLayoutMaps.size || this.layoutReconcileTimer !== undefined) return;
    this.layoutReconcileTimer = window.setTimeout(() => {
      this.layoutReconcileTimer = undefined;
      for (const id of [...this.pendingLayoutMaps]) {
        this.pendingLayoutMaps.delete(id);
        void this.reconcile(id).catch((error: unknown) => {
          if (!this.host.stopped()) new Notice(`Could not switch the map to Center: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }, 200);
  }

  private refreshLayoutViews(mapId: string): void {
    if (this.host.stopped()) return;
    const map = this.host.index().maps().find((candidate) => candidate.id === mapId);
    if (map) for (const surface of this.host.surfaces()) if (surface.mapPath === map.path) surface.refresh();
    this.host.syncTopicPanes();
  }
}
