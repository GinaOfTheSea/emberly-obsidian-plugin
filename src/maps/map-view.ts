import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type EmberlyMapsPlugin from "../main";
import { EmberlyMapSurface } from "./map-surface";
import { loadEmberlyFonts } from "../emberly-engine/renderer-assets";

export const VIEW_TYPE_EMBERLY_MAP = "emberly-map-view";

/** The original separate-pane mode remains available for comparison/fallback. */
export class EmberlyMapView extends ItemView {
  private activeSurface?: EmberlyMapSurface;
  private mapPath = "";
  constructor(leaf: WorkspaceLeaf, private readonly plugin: EmberlyMapsPlugin) { super(leaf); }
  get surface(): EmberlyMapSurface {
    if (!this.activeSurface) throw new Error("The Emberly map view is not open.");
    return this.activeSurface;
  }
  getViewType(): string { return VIEW_TYPE_EMBERLY_MAP; }
  getDisplayText(): string { return this.plugin.index.mapByPath(this.mapPath)?.title ?? "Emberly Map"; }
  getIcon(): string { return "network"; }
  getState(): Record<string, unknown> { return { mapPath: this.mapPath }; }
  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    this.mapPath = typeof state.mapPath === "string" ? state.mapPath : "";
    await super.setState(state, result);
    if (this.activeSurface) {
      this.activeSurface.mapPath = this.mapPath;
      this.activeSurface.refresh();
    }
  }
  async onOpen(): Promise<void> {
    await loadEmberlyFonts(this.contentEl.ownerDocument);
    this.activeSurface = new EmberlyMapSurface(this.contentEl, this.leaf, this.plugin, this.mapPath);
    this.activeSurface.refresh();
  }
  async onClose(): Promise<void> {
    this.plugin.releaseTopicLeaf(this.leaf);
    this.activeSurface?.dispose();
    this.activeSurface = undefined;
  }
}
