import { setIcon, type MarkdownView, type TFile } from "obsidian";
import type EmberlyMapsPlugin from "../main";
import type { EmberlyMap } from "../shared/types";
import { EmberlyMapSurface } from "./map-surface";
import { belongsToIntegratedMap, inspectorWidth } from "./integrated-map-state";

/** Adds only our own siblings. Never reparents, replaces or constructs an editor. */
export class IntegratedMapPane {
  readonly surface: EmberlyMapSurface;
  readonly mapId: string;
  private currentFile: TFile | null;
  private readonly host: HTMLElement;
  private readonly divider: HTMLElement;
  private readonly observer: MutationObserver;
  private readonly sizeObserver: ResizeObserver;
  private toggleButton?: HTMLButtonElement;
  private disposed = false;
  private collapsed = false;
  private width = 380;
  private dragging?: { pointer: number; x: number; width: number };
  get file(): TFile | null { return this.currentFile; }

  constructor(readonly view: MarkdownView, private readonly plugin: EmberlyMapsPlugin, map: EmberlyMap) {
    this.mapId = map.id;
    this.currentFile = view.file;
    view.containerEl.addClass("emberly-integrated-pane");
    this.host = view.contentEl.createDiv({ cls: "emberly-integrated-map emberly-map-view", attr: { tabindex: "-1" } });
    this.divider = view.contentEl.createDiv({ cls: "emberly-integrated-divider", attr: {
      role: "separator", tabindex: "0", "aria-label": "Resize notes panel", "aria-orientation": "vertical",
      "aria-valuemin": "240", "aria-valuemax": "720",
    } });
    this.surface = new EmberlyMapSurface(this.host, view.leaf, plugin, map.path, (actions) => {
      this.toggleButton = actions.createEl("button", { attr: { type: "button" } });
      this.toggleButton.addEventListener("click", () => this.setCollapsed(!this.collapsed));
      this.updateToggle();
    });
    this.divider.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.dragging = { pointer: event.pointerId, x: event.clientX, width: inspectorWidth(this.width, view.contentEl.clientWidth) };
      this.divider.setPointerCapture(event.pointerId);
      view.containerEl.addClass("emberly-integrated-resizing");
    });
    this.divider.addEventListener("pointermove", (event) => {
      if (this.dragging?.pointer !== event.pointerId) return;
      this.width = inspectorWidth(this.dragging.width + this.dragging.x - event.clientX, view.contentEl.clientWidth);
      this.updateWidth();
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) this.divider.addEventListener(event, () => {
      this.dragging = undefined;
      view.containerEl.removeClass("emberly-integrated-resizing");
    });
    this.divider.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const width = event.key === "Home" ? 240 : event.key === "End" ? 720 : inspectorWidth(this.width, view.contentEl.clientWidth) + (event.key === "ArrowLeft" ? 24 : -24);
      this.width = inspectorWidth(width, view.contentEl.clientWidth);
      this.updateWidth();
    });
    this.divider.addEventListener("dblclick", () => { this.width = 380; this.updateWidth(); });
    // Some native mode/file transitions replace content children. Reattach only
    // our containers, preserving the existing canvas, viewport and editor DOM.
    this.observer = new MutationObserver(() => this.ensureMounted());
    this.observer.observe(view.contentEl, { childList: true });
    this.sizeObserver = new ResizeObserver(() => this.updateWidth());
    this.sizeObserver.observe(view.contentEl);
    this.updateWidth();
  }

  start(): void { this.surface.refresh(); }

  /** A native link to another map or ordinary note ends the experimental layout. */
  acceptsCurrentFile(): boolean {
    const file = this.view.file;
    if (!file || this.plugin.index.file(file.path) !== file || this.plugin.index.isMapAsset(file.path)) return false;
    // Preserve the source map while a resource move changes this same file's
    // ownership/path. Its successful move flow returns to the source topic.
    if (file === this.currentFile) return true;
    const map = this.plugin.index.maps().find((candidate) => candidate.id === this.mapId);
    if (!map || !belongsToIntegratedMap(map, file.path, this.plugin.index.propertiesFor(file))) return false;
    this.currentFile = file;
    return true;
  }

  ensureMounted(): void {
    if (this.disposed || this.view.leaf.view !== this.view) return;
    if (this.host.parentElement !== this.view.contentEl) this.view.contentEl.append(this.host);
    if (this.divider.parentElement !== this.view.contentEl) this.view.contentEl.append(this.divider);
  }

  showInspector(): void { this.setCollapsed(false); }
  focusMap(): void { this.host.focus({ preventScroll: true }); }

  private setCollapsed(collapsed: boolean): void {
    if (collapsed) this.focusMap();
    this.collapsed = collapsed;
    this.view.containerEl.classList.toggle("emberly-integrated-collapsed", collapsed);
    this.updateToggle();
  }
  private updateToggle(): void {
    const label = this.collapsed ? "Show notes and resources" : "Hide notes and resources";
    this.toggleButton?.setAttribute("aria-label", label);
    this.toggleButton?.setAttribute("title", label);
    this.toggleButton?.setAttribute("aria-expanded", String(!this.collapsed));
    if (this.toggleButton) setIcon(this.toggleButton, this.collapsed ? "panel-right-open" : "panel-right-close");
  }
  private updateWidth(): void {
    if (this.disposed) return;
    const width = inspectorWidth(this.width, this.view.contentEl.clientWidth);
    this.view.contentEl.setCssProps({ "--emberly-inspector-width": `${width}px` });
    this.divider.setAttribute("aria-valuenow", String(width));
    this.divider.setAttribute("aria-valuemax", String(inspectorWidth(720, this.view.contentEl.clientWidth)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.sizeObserver.disconnect();
    this.surface.dispose();
    this.host.remove();
    this.divider.remove();
    this.view.contentEl.setCssProps({ "--emberly-inspector-width": "" });
    this.view.containerEl.removeClass("emberly-integrated-pane", "emberly-integrated-collapsed", "emberly-integrated-resizing");
  }
}
