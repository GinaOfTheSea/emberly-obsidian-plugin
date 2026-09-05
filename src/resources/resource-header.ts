import { Menu, Notice, setIcon, type App, type TFile } from "obsidian";
import offlinePreview from "../assets/placeholder_offline.svg";
import onlinePreview from "../assets/placeholder_online.svg";
import { readResourceSettings, resourceIdentity, resourceTagSuggestions, resourceWebUrl, type ResourceChange, type ResourceIdentity, type ResourceSettings } from "./resource-properties";
import type { EmberlyVaultIndex } from "../vault/vault-index";
import { ResourceTagSuggest } from "./resource-tag-suggest";

interface HeaderResource extends ResourceIdentity, ResourceSettings {
  file: TFile; title: string; kind: string; url: string; source: string; description: string;
}

/** Original ResourceView chrome; Obsidian continues to own the editor below it. */
export class ResourceHeader {
  readonly container: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly heading: HTMLElement;
  private readonly more: HTMLButtonElement;
  private readonly hero: HTMLElement;
  private readonly preview: HTMLImageElement;
  private readonly open: HTMLAnchorElement;
  private readonly title: HTMLElement;
  private readonly source: HTMLElement;
  private readonly description: HTMLElement;
  private readonly warning: HTMLElement;
  private readonly stars: HTMLButtonElement[] = [];
  private readonly clear: HTMLButtonElement;
  private readonly tags: HTMLElement;
  private readonly tagToggle: HTMLButtonElement;
  private readonly tagForm: HTMLFormElement;
  private readonly tagInput: HTMLInputElement;
  private readonly tagAdd: HTMLButtonElement;
  private readonly tagSuggest: ResourceTagSuggest;
  private availableTags: string[] = [];
  private readonly status: HTMLElement;
  private resource: HeaderResource | undefined;
  private attachment: TFile | undefined;
  private returnTopic: TFile | undefined;
  private menu: Menu | undefined;
  private generation = 0;
  private saving = false;
  private tagSignature = "";
  private imageSignature = "";
  private sourceSignature = "";
  private fallback = offlinePreview;

  constructor(
    parent: HTMLElement,
    app: App,
    private readonly index: EmberlyVaultIndex,
    private readonly save: (file: TFile, identity: ResourceIdentity, change: ResourceChange) => Promise<ResourceSettings>,
    private readonly goBack: (file: TFile) => void,
    private readonly openAttachment: (file: TFile) => Promise<void>,
    private readonly showDetails: () => void,
    private readonly moveResource: (file: TFile) => void,
  ) {
    this.container = parent.createDiv({ cls: "emberly-resource-header" });
    this.container.hidden = true;
    const bar = this.container.createDiv({ cls: "emberly-resource-bar" });
    this.back = this.iconButton(bar, "arrow-left", "Back to topic resources");
    this.back.addEventListener("click", () => { if (this.returnTopic) this.goBack(this.returnTopic); });
    this.heading = bar.createDiv({ cls: "emberly-resource-bar-title", text: "Resource" });
    this.more = this.iconButton(bar, "more-vertical", "Resource options");
    this.more.setAttribute("aria-haspopup", "menu");
    this.more.setAttribute("aria-expanded", "false");
    this.more.addEventListener("click", () => this.showMenu());

    this.hero = this.container.createDiv({ cls: "emberly-resource-hero" });
    this.preview = this.hero.createEl("img", { cls: "emberly-resource-cover", attr: { alt: "", decoding: "async" } });
    this.preview.addEventListener("error", () => {
      if (this.preview.src !== this.fallback) this.preview.src = this.fallback;
    });
    this.open = this.hero.createEl("a", { cls: "emberly-resource-open", attr: { "aria-label": "Open resource", title: "Open resource", target: "_blank", rel: "noopener noreferrer" } });
    setIcon(this.open, "external-link");
    this.open.addEventListener("click", (event) => {
      if (this.open.getAttribute("aria-disabled") === "true") { event.preventDefault(); return; }
      if (this.attachment) {
        event.preventDefault();
        const file = this.attachment;
        if (this.index.file(file.path) !== file) { new Notice("This attachment is no longer available."); return; }
        void this.openAttachment(file).catch((error) => new Notice(`Could not open attachment: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    this.open.addEventListener("keydown", (event) => {
      if (this.attachment && (event.key === " " || event.key === "Enter")) { event.preventDefault(); this.open.click(); }
    });

    const copy = this.container.createDiv({ cls: "emberly-resource-header-copy" });
    this.title = copy.createEl("h2", { cls: "emberly-resource-header-title" });
    this.source = copy.createDiv({ cls: "emberly-resource-header-source" });
    this.description = copy.createEl("p", { cls: "emberly-resource-header-description" });
    this.warning = copy.createDiv({ cls: "emberly-resource-header-warning", attr: { role: "status" } });
    const rating = this.container.createDiv({ cls: "emberly-resource-rating", attr: { role: "group", "aria-label": "Resource rating out of five" } });
    const stars = rating.createDiv({ cls: "emberly-resource-stars" });
    for (let value = 1; value <= 5; value++) {
      const button = this.iconButton(stars, "star", `Rate ${value} out of 5`);
      button.addEventListener("click", () => void this.commit({ rating: this.resource?.rating === value ? 0 : value }));
      button.addEventListener("pointerenter", () => { if (!this.saving) this.renderStars(value); });
      this.stars.push(button);
    }
    stars.addEventListener("pointerleave", () => this.renderStars());
    this.clear = rating.createEl("button", { cls: "emberly-resource-text-button", text: "clear rating", attr: { type: "button" } });
    this.clear.addEventListener("click", () => void this.commit({ rating: 0 }));
    const tagRow = this.container.createDiv({ cls: "emberly-resource-header-tags" });
    this.tags = tagRow;
    this.tagToggle = tagRow.createEl("button", { cls: "emberly-resource-text-button", text: "add/remove tag", attr: { type: "button", "aria-expanded": "false" } });
    this.tagToggle.addEventListener("click", () => this.toggleTags());
    this.tagForm = this.container.createEl("form", { cls: "emberly-resource-tag-form", attr: { "aria-label": "Add resource tag" } });
    this.tagForm.id = `emberly-resource-tags-${crypto.randomUUID()}`;
    this.tagForm.hidden = true;
    this.tagToggle.setAttribute("aria-controls", this.tagForm.id);
    this.tagInput = this.tagForm.createEl("input", { type: "text", placeholder: "e.g. sailing/weather", attr: { "aria-label": "New tag", autocomplete: "off" } });
    this.tagSuggest = new ResourceTagSuggest(app, this.tagInput, (query) => {
      if (!this.resource || this.saving || this.tagForm.hidden) return [];
      const generation = this.generation;
      // Filtering is in memory. Do not scan the vault on each keystroke.
      return resourceTagSuggestions(this.availableTags, this.resource.tags, query).map((tag) => ({
        tag, select: () => {
          if (generation === this.generation && !this.tagForm.hidden) void this.addTag(tag);
        },
      }));
    });
    this.tagAdd = this.tagForm.createEl("button", { text: "Add", attr: { type: "submit" } });
    this.tagForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.addTag(this.tagInput.value);
    });
    this.tagForm.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.toggleTags(false); this.tagToggle.focus(); }
    });
    this.status = this.container.createDiv({ cls: "emberly-resource-header-status", attr: { role: "status", "aria-live": "polite" } });
  }

  update(file: TFile | null, properties: Record<string, unknown>, returnTopic?: TFile): void {
    const identity = resourceIdentity(properties);
    const changed = file !== this.resource?.file || identity?.id !== this.resource?.id || identity?.mapId !== this.resource?.mapId;
    if (changed || !identity || !file) {
      this.generation++; this.saving = false; this.menu?.hide(); this.status.setText("");
      this.tagSuggest.close(); this.availableTags = [];
      this.tagForm.hidden = true; this.tagToggle.setAttribute("aria-expanded", "false"); this.tagInput.value = "";
      this.tagSignature = "";
    }
    this.returnTopic = returnTopic && this.index.file(returnTopic.path) === returnTopic ? returnTopic : undefined;
    this.resource = file && identity ? {
      ...identity, ...readResourceSettings(properties), file,
      title: file.basename,
      kind: typeof properties["emberly-kind"] === "string" ? properties["emberly-kind"] : "note",
      url: typeof properties.url === "string" ? properties.url : "",
      source: typeof properties.source === "string" ? properties.source : "",
      description: typeof properties.description === "string" ? properties.description : "",
    } : undefined;
    this.container.hidden = !this.resource;
    if (!this.resource) { this.attachment = undefined; this.preview.removeAttribute("src"); this.imageSignature = ""; return; }
    const resource = this.resource;
    if (!this.tagForm.hidden) this.availableTags = this.index.resourceTagsForMap(resource.mapId);
    const media = this.index.resourceMedia(resource.file, properties);
    this.attachment = media.asset;
    this.fallback = resource.kind === "link" ? onlinePreview : offlinePreview;
    const src = media.thumbnail ?? this.fallback;
    const imageSignature = JSON.stringify([src, media.asset?.stat.mtime, media.asset?.stat.size]);
    // Note autosaves must not restart images, rebuild inputs or steal focus.
    if (imageSignature !== this.imageSignature) { this.imageSignature = imageSignature; this.preview.src = src; }
    this.hero.hidden = resource.kind === "note";
    const url = resource.kind === "link" ? resourceWebUrl(resource.url) : undefined;
    this.open.removeAttribute("href");
    if (url) this.open.href = url;
    this.open.setAttribute("role", this.attachment ? "button" : "link");
    this.open.tabIndex = this.attachment || url ? 0 : -1;
    this.open.setAttribute("aria-disabled", String(!this.attachment && !url));
    const openLabel = this.attachment ? "Open attachment in Obsidian" : url ? "Open website in browser" : "Resource unavailable";
    this.open.setAttribute("aria-label", openLabel); this.open.title = openLabel;
    this.title.setText(resource.title);
    const sourceSignature = JSON.stringify([url, resource.source]);
    if (sourceSignature !== this.sourceSignature) {
      this.sourceSignature = sourceSignature; this.source.empty();
      if (url) {
        const link = this.source.createEl("a", { text: new URL(url).hostname, attr: { href: url, target: "_blank", rel: "noopener noreferrer" } });
        setIcon(link.createSpan(), "external-link");
      } else this.source.setText(resource.source);
    }
    this.source.hidden = !url && !resource.source;
    this.description.setText(resource.description); this.description.hidden = !resource.description;
    const issue = media.issue ?? (resource.kind === "link" && !url ? "The web address is missing or unsupported. Use an http or https URL in Details." : "");
    this.warning.setText(issue); this.warning.hidden = !issue;
    this.renderSettings();
  }

  private renderSettings(): void {
    if (!this.resource) return;
    this.heading.setText("Resource");
    this.back.disabled = !this.returnTopic;
    this.more.disabled = this.saving;
    this.renderStars();
    this.clear.disabled = this.saving || this.resource.rating === 0;
    this.tagToggle.disabled = this.saving; this.tagInput.disabled = this.saving; this.tagAdd.disabled = this.saving;
    const signature = JSON.stringify([this.resource.tags, this.tagForm.hidden, this.saving]);
    if (signature === this.tagSignature) return;
    this.tagSignature = signature;
    // Keep the toggle mounted (and focused) while replacing only the chips.
    for (const chip of Array.from(this.tags.querySelectorAll<HTMLElement>(":scope > .emberly-resource-tag-chip"))) chip.remove();
    for (const tag of this.resource.tags) {
      const chip = this.tags.createSpan({ cls: "emberly-resource-tag-chip" });
      this.tags.insertBefore(chip, this.tagToggle);
      chip.createSpan({ text: tag });
      if (!this.tagForm.hidden) {
        const remove = this.iconButton(chip, "x", `Remove tag ${tag}`);
        remove.disabled = this.saving;
        remove.addEventListener("click", () => {
          const generation = this.generation;
          void this.commit({ removeTag: tag }).then(() => { if (generation === this.generation) this.tagInput.focus(); });
        });
      }
    }
  }

  private renderStars(value = this.resource?.rating ?? 0): void {
    for (const [index, button] of this.stars.entries()) {
      button.classList.toggle("is-filled", index < value);
      button.setAttribute("aria-pressed", String(index + 1 === this.resource?.rating));
      button.disabled = this.saving;
    }
  }

  private toggleTags(show = this.tagForm.hidden): void {
    this.tagSuggest.close();
    this.availableTags = show && this.resource ? this.index.resourceTagsForMap(this.resource.mapId) : [];
    this.tagForm.hidden = !show; this.tagToggle.setAttribute("aria-expanded", String(show));
    this.renderSettings(); if (show) this.tagInput.focus();
  }

  private async addTag(tag: string): Promise<void> {
    if (this.saving) return;
    const generation = this.generation;
    const saved = await this.commit({ addTag: tag });
    if (generation !== this.generation || !saved) return;
    this.tagInput.value = "";
    // A new tag is immediately reusable, even before MetadataCache catches up.
    this.availableTags = resourceTagSuggestions([...this.availableTags, ...(this.resource?.tags ?? [])], [], "");
    if (!this.tagForm.hidden) this.tagInput.focus();
  }

  private showMenu(): void {
    if (!this.resource || this.saving) return;
    this.menu?.hide();
    const generation = this.generation;
    const menu = new Menu(); this.menu = menu;
    this.more.setAttribute("aria-expanded", "true");
    menu.setUseNativeMenu(false);
    menu.addItem((item) => item.setTitle("Move…").setIcon("folder-input").onClick(() => {
      if (generation === this.generation && this.resource) this.moveResource(this.resource.file);
    }));
    menu.addItem((item) => item.setTitle("Show note details").setIcon("sliders-horizontal").onClick(() => {
      if (generation === this.generation) this.showDetails();
    }));
    menu.onHide(() => {
      if (this.menu === menu) { this.menu = undefined; this.more.setAttribute("aria-expanded", "false"); }
    });
    const bounds = this.more.getBoundingClientRect();
    menu.showAtPosition({ x: bounds.left, y: bounds.bottom }, this.container.ownerDocument);
  }

  private async commit(change: ResourceChange): Promise<boolean> {
    const resource = this.resource;
    if (!resource || this.saving) return false;
    const generation = this.generation;
    this.tagSuggest.close();
    this.saving = true; this.status.setText("Saving…"); this.renderSettings();
    try {
      const saved = await this.save(resource.file, resource, change);
      if (generation === this.generation && this.resource) { Object.assign(this.resource, saved); this.status.setText(""); }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (generation === this.generation) this.status.setText(`Not saved: ${message}`);
      new Notice(`Could not save resource settings: ${message}`);
      return false;
    } finally {
      if (generation === this.generation) { this.saving = false; this.renderSettings(); }
    }
  }

  private iconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
    const button = parent.createEl("button", { attr: { type: "button", "aria-label": label, title: label } });
    setIcon(button, icon); return button;
  }

  dispose(): void { this.generation++; this.tagSuggest.close(); this.menu?.hide(); this.container.remove(); }
}
