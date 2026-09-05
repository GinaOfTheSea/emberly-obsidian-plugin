import type { App, TFile } from "obsidian";
import { MapReferenceIndex } from "../maps/map-reference-index";
import type { EmberlyMapSurface } from "../maps/map-surface";
import type { EmberlyVaultIndex } from "../vault/vault-index";

export interface ReferenceCoordinatorHost {
  app: App;
  vaultIndex(): EmberlyVaultIndex;
  surfaces(): EmberlyMapSurface[];
  associatedFile(surface: EmberlyMapSurface): TFile | null;
  selectionBlocked(surface: EmberlyMapSurface): boolean;
  stopped(): boolean;
  refresh(): void;
}

/** Keeps Markdown reference derivation independent from canvas and pane lifecycles. */
export class ReferenceCoordinator {
  private readonly references = new MapReferenceIndex();
  private readonly pendingPaths = new Set<string>();
  private timer?: number;
  private ready = false;
  private rebuild = true;

  constructor(private readonly host: ReferenceCoordinatorHost) {}

  invalidate(): void {
    this.ready = false;
    this.rebuild = true;
    this.syncViews();
    this.schedule();
  }

  schedule(path?: string): void {
    if (this.host.stopped()) return;
    if (path) this.pendingPaths.add(path);
    if (this.timer !== undefined) return;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.host.refresh();
    }, 60);
  }

  retryUnresolved(): void {
    for (const path of this.references.pendingResolution()) this.pendingPaths.add(path);
    this.schedule();
  }

  refresh(): void {
    if (this.host.stopped()) return;
    const { app } = this.host;
    const vaultIndex = this.host.vaultIndex();
    const added = this.references.syncOwnership(vaultIndex.maps(), vaultIndex.resourceCatalog().resources);
    const paths = this.rebuild ? this.references.paths() : [...new Set([...added, ...this.pendingPaths])];
    this.rebuild = false;
    this.pendingPaths.clear();
    for (const path of paths) {
      const file = vaultIndex.file(path);
      this.references.update(path, file ? app.metadataCache.getFileCache(file) : null,
        (linkpath, source) => app.metadataCache.getFirstLinkpathDest(linkpath, source));
    }
    this.ready = true;
    this.syncViews();
  }

  syncViews(): void {
    for (const surface of this.host.surfaces()) {
      const file = this.host.associatedFile(surface);
      const selection = !this.host.stopped() && this.ready && !this.host.selectionBlocked(surface)
        && file && this.host.vaultIndex().file(file.path) === file
        ? this.references.selection(surface.mapPath, file.path) : null;
      surface.setReferenceSelection(selection);
    }
  }

  dispose(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.pendingPaths.clear();
    this.references.clear();
    this.ready = false;
  }
}
