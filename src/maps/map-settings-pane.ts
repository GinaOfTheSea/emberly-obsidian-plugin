import { Setting, setIcon } from "obsidian";
import type { EmberlyCenterMode, EmberlyLayout, EmberlyMap, MapIconVisibility } from "../shared/types";
import type { MapCenterChange } from "./map-center";
import centerPreview from "../assets/layout_tree.svg";
import branchPreview from "../assets/layout_sapling.svg";
import { BRANCH_LAYOUT_REQUIREMENT, canUseBranchLayout } from "./map-layout";

export interface MapSettingsActions {
  rename(map: EmberlyMap, name: string): Promise<void>;
  layout(map: EmberlyMap, layout: EmberlyLayout): Promise<void>;
  center(map: EmberlyMap, change: MapCenterChange): Promise<void>;
  icons(map: EmberlyMap, key: keyof MapIconVisibility, visible: boolean): Promise<void>;
  duplicate(map: EmberlyMap): Promise<void>;
  move(map: EmberlyMap): void;
  trash(map: EmberlyMap): Promise<void | boolean>;
}

/** Legacy map settings, presented alongside the untouched native root note. */
export class MapSettingsPane {
  readonly container: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly rename: HTMLButtonElement;
  private readonly layouts: Map<EmberlyLayout, HTMLButtonElement> = new Map();
  private readonly info: HTMLElement;
  private readonly layoutHint: HTMLElement;
  private readonly status: HTMLElement;
  private readonly centerSection: HTMLElement;
  private readonly centers = new Map<EmberlyCenterMode, HTMLButtonElement>();
  private readonly centerTextForm: HTMLFormElement;
  private readonly centerText: HTMLInputElement;
  private readonly centerTextSave: HTMLButtonElement;
  private readonly imageInput: HTMLInputElement;
  private readonly centerImageControls: HTMLElement;
  private readonly imagePreview: HTMLImageElement;
  private readonly replaceImage: HTMLButtonElement;
  private readonly imageIssue: HTMLElement;
  private readonly iconToggles = new Map<keyof MapIconVisibility, import("obsidian").ToggleComponent>();
  private readonly duplicateButton: HTMLButtonElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly trashButton: HTMLButtonElement;
  private map?: EmberlyMap;
  private generation = 0;
  private saving = false;
  private imageMapId?: string;
  private failedImageUrl?: string;

  constructor(parent: HTMLElement, private readonly actions: MapSettingsActions) {
    this.container = parent.createDiv({ cls: "emberly-map-settings-panel", attr: { role: "tabpanel", "aria-label": "Map settings" } });
    const form = this.container.createEl("form", { cls: "emberly-map-name-form" });
    const label = form.createEl("label", { text: "Map name" });
    this.name = label.createEl("input", { attr: { type: "text", "aria-label": "Map name", autocomplete: "off" } });
    this.rename = form.createEl("button", { text: "Rename", attr: { type: "submit" } });
    this.info = this.container.createDiv({ cls: "emberly-map-settings-info" });
    this.name.addEventListener("input", () => this.updateDisabled());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!this.rename.disabled) void this.save((map) => this.actions.rename(map, this.name.value.trim()));
    });
    const section = this.container.createEl("section", { cls: "emberly-map-layout-section" });
    section.createEl("h3", { text: "Layout" });
    const layouts = section.createDiv({ cls: "emberly-map-layout-options", attr: { role: "group", "aria-label": "Layout mode" } });
    for (const [layout, label, preview] of [["center", "Center", centerPreview], ["branch", "Branch", branchPreview]] as const) {
      const button = layouts.createEl("button", { cls: "emberly-map-layout-option", attr: { type: "button", "aria-label": `${label} layout` } });
      button.createEl("img", { attr: { src: preview, alt: "", draggable: "false" } });
      button.createSpan({ text: label });
      button.addEventListener("click", () => {
        if (this.map?.layout !== layout) void this.save((map) => this.actions.layout(map, layout));
      });
      this.layouts.set(layout, button);
    }
    this.layoutHint = section.createDiv({
      cls: "emberly-map-layout-hint",
      text: BRANCH_LAYOUT_REQUIREMENT,
      attr: { id: "emberly-branch-layout-requirement", role: "note" },
    });
    this.layouts.get("branch")?.setAttribute("aria-describedby", "emberly-branch-layout-requirement");
    this.centerSection = section.createDiv({ cls: "emberly-map-center-section" });
    this.centerSection.createEl("h3", { text: "Center node" });
    const centers = this.centerSection.createDiv({ cls: "emberly-map-center-options", attr: { role: "group", "aria-label": "Center appearance" } });
    this.imageInput = this.centerSection.createEl("input", { attr: { type: "file", accept: ".png,.jpg,.jpeg,.gif,.webp,.avif", "aria-label": "Center image" } });
    this.imageInput.hidden = true;
    for (const [mode, label] of [["avatar", "Default"], ["text", "Text"], ["image", "Image"]] as const) {
      const button = centers.createEl("button", { text: label, attr: { type: "button" } });
      button.addEventListener("click", () => {
        if (mode === "image") this.chooseImage();
        else if ((this.map?.center?.mode ?? "avatar") !== mode) {
          void this.save((map) => this.actions.center(map, mode === "text" ? { mode, text: "" } : { mode }));
        }
      });
      this.centers.set(mode, button);
    }
    this.centerTextForm = this.centerSection.createEl("form", { cls: "emberly-map-center-text-form" });
    this.centerText = this.centerTextForm.createEl("input", { attr: { type: "text", "aria-label": "Center text", maxlength: "500" } });
    this.centerTextSave = this.centerTextForm.createEl("button", { text: "Save", attr: { type: "submit" } });
    this.centerTextForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = this.centerText.value;
      void this.save((map) => this.actions.center(map, { mode: "text", text }));
    });
    this.centerImageControls = this.centerSection.createDiv({ cls: "emberly-map-center-image-controls" });
    this.imagePreview = this.centerImageControls.createEl("img", { cls: "emberly-map-center-preview", attr: { alt: "Center image", draggable: "false" } });
    this.imagePreview.addEventListener("error", () => {
      this.failedImageUrl = this.imagePreview.getAttribute("src") ?? undefined;
      this.imagePreview.hidden = true;
      this.imageIssue.setText("The center image could not be loaded. Choose another image.");
      this.imageIssue.hidden = false;
    });
    this.replaceImage = this.centerImageControls.createEl("button", { text: "Upload custom photo", attr: { type: "button" } });
    this.replaceImage.addEventListener("click", () => this.chooseImage());
    this.imageInput.addEventListener("change", () => {
      const file = this.imageInput.files?.[0];
      this.imageInput.value = "";
      const sameMap = this.imageMapId === this.map?.id;
      this.imageMapId = undefined;
      if (file && sameMap) void this.save((map) => this.actions.center(map, { mode: "image", file }));
    });
    this.imageIssue = this.centerSection.createDiv({ cls: "emberly-map-layout-hint", attr: { role: "status" } });
    const icons = this.container.createEl("section", { cls: "emberly-map-settings-section" });
    icons.createEl("h3", { text: "Show icons" });
    for (const [key, label, icon] of [["notes", "Has notes", "text"], ["resources", "Has resources", "paperclip"]] as const) {
      const setting = new Setting(icons).setName(label);
      setIcon(setting.nameEl.createSpan({ cls: "emberly-map-setting-icon", prepend: true }), icon);
      setting.addToggle((toggle) => {
        toggle.toggleEl.setAttribute("aria-label", label);
        toggle.onChange((visible) => { void this.save((map) => this.actions.icons(map, key, visible)); });
        this.iconToggles.set(key, toggle);
      });
    }
    const fileActions = this.container.createEl("section", { cls: "emberly-map-settings-section emberly-map-file-actions" });
    fileActions.createEl("h3", { text: "Actions" });
    this.duplicateButton = fileActions.createEl("button", { attr: { type: "button" } });
    setIcon(this.duplicateButton.createSpan(), "copy"); this.duplicateButton.createSpan({ text: "Duplicate" });
    this.duplicateButton.addEventListener("click", () => void this.save((map) => this.actions.duplicate(map)));
    this.moveButton = fileActions.createEl("button", { attr: { type: "button" } });
    setIcon(this.moveButton.createSpan(), "folder-input"); this.moveButton.createSpan({ text: "Move map" });
    this.moveButton.addEventListener("click", () => { if (this.map && !this.moveButton.disabled) this.actions.move(this.map); });
    this.trashButton = fileActions.createEl("button", { cls: "emberly-map-trash", attr: { type: "button" } });
    setIcon(this.trashButton.createSpan(), "trash-2"); this.trashButton.createSpan({ text: "Move to trash" });
    this.trashButton.addEventListener("click", () => void this.save((map) => this.actions.trash(map)));
    this.status = this.container.createDiv({ cls: "emberly-map-settings-status", attr: { role: "status", "aria-live": "polite" } });
    this.update();
  }

  update(map?: EmberlyMap): void {
    const changed = map?.id !== this.map?.id;
    if (changed) { this.generation++; this.saving = false; this.status.setText(""); }
    this.map = map;
    if (changed || this.name.ownerDocument.activeElement !== this.name) this.name.value = map?.title ?? "";
    for (const [layout, button] of this.layouts) button.setAttribute("aria-pressed", String(map?.layout === layout));
    const mode = map?.center?.mode ?? "avatar";
    this.centerSection.hidden = map?.layout !== "center";
    for (const [option, button] of this.centers) button.setAttribute("aria-pressed", String(mode === option));
    this.centerTextForm.hidden = mode !== "text";
    if (changed || this.centerText.ownerDocument.activeElement !== this.centerText) this.centerText.value = map?.center?.text ?? "";
    this.centerText.placeholder = map?.title ?? "Center text";
    const imageUrl = map?.center?.imageUrl;
    const failedImage = Boolean(imageUrl && imageUrl === this.failedImageUrl);
    this.imagePreview.hidden = mode !== "image" || !imageUrl || failedImage;
    if (imageUrl && this.imagePreview.getAttribute("src") !== imageUrl) this.imagePreview.src = imageUrl;
    else if (!imageUrl) this.imagePreview.removeAttribute("src");
    this.centerImageControls.hidden = mode === "text";
    this.replaceImage.hidden = mode === "text";
    this.replaceImage.setText(mode === "image" ? "Replace photo" : "Upload custom photo");
    this.imageIssue.setText(map?.center?.issue ?? (failedImage ? "The center image could not be loaded. Choose another image." : ""));
    this.imageIssue.hidden = !map?.center?.issue && !failedImage;
    for (const [key, toggle] of this.iconToggles) toggle.setValue(map?.showIcons?.[key] !== false);
    this.info.setText(map ? `${map.nodes.length} topics` : "");
    this.updateDisabled();
  }

  private updateDisabled(): void {
    const disabled = !this.map || Boolean(this.map.issues.length) || this.saving;
    this.name.disabled = disabled;
    this.rename.disabled = disabled || !this.name.value.trim() || this.name.value.trim() === this.map?.title;
    const branchAllowed = Boolean(this.map && canUseBranchLayout(this.map));
    for (const [layout, button] of this.layouts) button.disabled = disabled || (layout === "branch" && !branchAllowed);
    this.layoutHint.hidden = !this.map || branchAllowed;
    const centerDisabled = disabled || this.map?.layout !== "center" || this.map.format !== 2;
    for (const button of this.centers.values()) button.disabled = centerDisabled;
    this.centerText.disabled = this.centerTextSave.disabled = this.imageInput.disabled = this.replaceImage.disabled = centerDisabled;
    const actionsDisabled = disabled || this.map?.format !== 2;
    for (const toggle of this.iconToggles.values()) toggle.setDisabled(actionsDisabled);
    this.duplicateButton.disabled = this.moveButton.disabled = this.trashButton.disabled = actionsDisabled;
  }

  private chooseImage(): void {
    this.imageMapId = this.map?.id;
    this.imageInput.click();
  }

  private async save(action: (map: EmberlyMap) => Promise<void | boolean>): Promise<void> {
    const map = this.map;
    if (!map || map.issues.length || this.saving) return;
    const generation = this.generation;
    this.saving = true; this.status.setText(""); this.updateDisabled();
    try {
      await action(map);
    } catch (error) {
      if (generation === this.generation) this.status.setText(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === this.generation) { this.saving = false; this.update(this.map); }
    }
  }

  dispose(): void { this.generation++; this.map = undefined; this.container.remove(); }
}
