import { Notice, setIcon, type MarkdownView, type TFile } from "obsidian";
import type { EmberlyVaultIndex } from "../vault/vault-index";
import type { TopicResource } from "../resources/resource-list";
import { TopicHeader, type RenameTopic } from "./topic-header";
import type { TopicAppearance, TopicAppearanceChange, TopicIdentity } from "./topic-appearance";
import { ResourceHeader } from "../resources/resource-header";
import { resourceIdentity, type ResourceChange, type ResourceIdentity, type ResourceSettings } from "../resources/resource-properties";
import offlinePreview from "../assets/placeholder_offline.svg";
import onlinePreview from "../assets/placeholder_online.svg";
import { ResourceCreatePane } from "../resources/resource-create-pane";
import type { ResourceCreateResult, ResourceDraft, ResourceTarget } from "../resources/resource-create";
import { ResourceMovePicker } from "../resources/resource-move-picker";
import { MapSettingsPane, type MapSettingsActions } from "../maps/map-settings-pane";
import type { EmberlyMap } from "../shared/types";
export interface ResourceMoveSession {
  choose(mapId: string, topicId: string): void;
  cancel(): void;
}

export type TopicPaneSection = "notes" | "resources" | "settings";
export interface TopicPaneNavigation {
  section?: TopicPaneSection;
  returnTopic?: TFile;
}

/** Presentation only: the native Markdown editor still owns all note content. */
export class TopicNotePane {
  private detailsVisible = false;
  private detailsButton: HTMLElement;
  private readonly chrome: HTMLElement;
  private readonly header: TopicHeader;
  private readonly mapHeader: HTMLElement;
  private readonly mapSettings: MapSettingsPane;
  private readonly settingsButton: HTMLButtonElement;
  private rootMap?: EmberlyMap;
  private readonly resourceHeader: ResourceHeader;
  private readonly tabs: HTMLElement;
  private readonly notesButton: HTMLButtonElement;
  private readonly resourcesButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly resourcePanel: HTMLElement;
  private readonly resourceList: HTMLElement;
  private readonly resourceCreate: ResourceCreatePane;
  private section: TopicPaneSection = "notes";
  private returnTopic: TFile | undefined;
  private currentPath = "";
  private currentFile: TFile | null = null;
  private resourceSignature = "";
  private isTopic = false;
  private canHaveResources = false;
  private movePicker?: ResourceMovePicker;
  private moveSession?: ResourceMoveSession;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    this.toggleDetails();
  };

  constructor(
    readonly view: MarkdownView,
    private readonly index: EmberlyVaultIndex,
    private readonly openFile: (path: string, navigation?: TopicPaneNavigation) => Promise<void>,
    saveAppearance: (file: TFile, identity: TopicIdentity, change: TopicAppearanceChange) => Promise<TopicAppearance>,
    saveResource: (file: TFile, identity: ResourceIdentity, change: ResourceChange) => Promise<ResourceSettings>,
    createResources: (target: ResourceTarget, draft: ResourceDraft) => Promise<ResourceCreateResult>,
    private readonly beginMove: (file: TFile, status: (busy: boolean, message: string) => void, finish: () => void) => ResourceMoveSession,
    mapSettings: MapSettingsActions,
    renameTopic?: RenameTopic,
  ) {
    view.containerEl.addClass("emberly-topic-pane");
    this.chrome = view.contentEl.createDiv({ cls: "emberly-topic-chrome" });
    view.contentEl.prepend(this.chrome);
    this.backButton = this.chrome.createEl("button", { cls: "emberly-topic-back" });
    this.backButton.addEventListener("click", () => {
      if (this.returnTopic) this.navigate(this.returnTopic.path, { section: "resources" });
    });
    this.header = new TopicHeader(this.chrome, saveAppearance, (file) => {
      const map = this.index.mapContaining(file.path);
      const node = map?.nodes.find((candidate) => candidate.path === file.path);
      return Boolean(map && !map.issues.length && node?.parentId && map.nodes.some((parent) => parent.id === node.parentId && parent.parentId));
    }, renameTopic);
    this.resourceHeader = new ResourceHeader(this.chrome, this.view.app, this.index, saveResource,
      (file) => this.navigate(file.path, { section: "resources" }),
      async (file) => { await this.view.app.workspace.getLeaf("tab").openFile(file); },
      () => { this.detailsVisible = true; this.updatePresentation(); },
      (file) => this.startMove(file),
    );
    this.mapHeader = this.chrome.createEl("h2", { cls: "emberly-map-settings-header", text: "Map settings" });
    this.tabs = this.chrome.createDiv({ cls: "emberly-topic-tabs", attr: { role: "tablist", "aria-label": "Topic content" } });
    this.settingsButton = this.createTab("Settings", "settings");
    this.resourcesButton = this.createTab("Resources", "resources");
    this.notesButton = this.createTab("Notes", "notes");
    this.tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const sections = (["settings", "resources", "notes"] as const).filter((section) => section === "settings" ? Boolean(this.rootMap) : section === "resources" ? this.canHaveResources : true);
      const index = sections.indexOf(this.section);
      const section = sections[event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + sections.length) % sections.length]!;
      this.setSection(section);
      (section === "settings" ? this.settingsButton : section === "notes" ? this.notesButton : this.resourcesButton).focus();
    });
    this.mapSettings = new MapSettingsPane(view.contentEl, mapSettings);
    this.resourcePanel = view.contentEl.createDiv({ cls: "emberly-topic-resource-panel", attr: { role: "tabpanel", "aria-label": "Topic resources", tabindex: "0" } });
    this.resourceCreate = new ResourceCreatePane(this.resourcePanel, view.containerEl, () => {
      const file = this.view.file;
      if (!this.canHaveResources || this.section !== "resources" || !file) return undefined;
      const fm = this.index.propertiesFor(file);
      return fm?.emberly === "topic" && fm["emberly-format"] === 2 && typeof fm["emberly-id"] === "string" && typeof fm["emberly-map"] === "string"
        ? { file, id: fm["emberly-id"], mapId: fm["emberly-map"] } : undefined;
    }, createResources, async (target, path) => {
      this.resourceSignature = ""; this.update();
      if (path && this.view.file === target.file) await this.openFile(path, { returnTopic: target.file });
    });
    this.resourceList = this.resourcePanel.createDiv({ cls: "emberly-topic-resource-list" });
    this.detailsButton = this.createDetailsButton();
    this.update();
  }

  update(): void {
    if (!this.view.contentEl.contains(this.chrome)) this.view.contentEl.prepend(this.chrome);
    if (!this.view.contentEl.contains(this.resourcePanel)) this.view.contentEl.append(this.resourcePanel);
    if (!this.view.contentEl.contains(this.mapSettings.container)) this.view.contentEl.append(this.mapSettings.container);
    const file = this.view.file;
    const fileChanged = file !== this.currentFile;
    if (file?.path !== this.currentPath) {
      if (file !== this.currentFile) { this.stopMove(); this.section = "notes"; }
      this.currentFile = file;
      this.currentPath = file?.path ?? "";
      this.resourceSignature = "";
    }
    const fm = file && this.index.propertiesFor(file);
    const map = file ? this.index.mapContaining(file.path) : undefined;
    const roots = map?.nodes.filter((node) => !node.parentId) ?? [];
    const rootMap = map && !map.issues.length && roots.length === 1 && roots[0]!.path === file?.path ? map : undefined;
    if (rootMap && (fileChanged || rootMap.id !== this.rootMap?.id)) this.section = "settings";
    this.rootMap = rootMap;
    this.mapSettings.update(rootMap);
    this.mapHeader.hidden = !rootMap;
    this.settingsButton.hidden = !rootMap;
    // Passing null also dismisses any open topic popup when entering the root.
    this.header.update(rootMap ? null : file, fm ?? {});
    this.isTopic = fm?.emberly === "topic" && fm["emberly-format"] === 2;
    this.canHaveResources = Boolean(this.isTopic && map && !map.issues.length
      && map.nodes.some((node) => node.path === file?.path && node.parentId !== null));
    const isResource = Boolean(file && resourceIdentity(fm ?? {}));
    this.view.containerEl.classList.toggle("emberly-topic-with-header", this.isTopic || isResource || Boolean(rootMap));
    this.view.containerEl.classList.toggle("emberly-resource-pane", isResource);
    if (fm?.emberly !== "resource") this.returnTopic = undefined;
    if (isResource && file) {
      const resource = this.index.resourceCatalog().resources.find((resource) => resource.path === file.path);
      const owner = resource && this.index.maps().find((map) => map.id === resource.mapId)?.nodes.find((node) => node.id === resource.topicId);
      this.returnTopic = owner ? this.index.file(owner.path) : undefined;
    }
    this.resourceHeader.update(file, fm ?? {}, this.returnTopic);
    this.tabs.hidden = !this.isTopic && !rootMap;
    this.resourcesButton.hidden = !this.canHaveResources;
    this.tabs.setAttribute("aria-label", rootMap ? "Map content" : "Topic content");
    this.backButton.hidden = isResource || !this.returnTopic || this.index.file(this.returnTopic.path) !== this.returnTopic;
    if (!this.backButton.hidden) {
      this.backButton.empty();
      setIcon(this.backButton.createSpan(), "arrow-left");
      this.backButton.createSpan({ text: "Back to topic resources" });
    }
    this.chrome.hidden = this.tabs.hidden && this.backButton.hidden && !isResource;
    if (this.canHaveResources && file) this.updateResources(file.basename);
    if (this.section === "resources" && !this.canHaveResources) this.section = rootMap ? "settings" : "notes";
    if ((!this.isTopic || this.section === "settings") && !rootMap) this.section = "notes";
    this.updateSection();
    this.updatePresentation();
  }

  /** Keystrokes only update presentation; no whole-vault scan or editor rebuild. */
  updatePresentation(): void {
    if (!this.view.containerEl.contains(this.detailsButton)) {
      this.detailsButton.removeEventListener("keydown", this.onKeyDown);
      this.detailsButton = this.createDetailsButton();
    }
    const body = this.view.getViewData()
      .replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
      .trimStart();
    // Keep the actual Markdown heading editable. Hide only Obsidian's extra
    // inline filename title when the document already begins with a title.
    const hasHeading = /^#\s+\S/.test(body) || /^[^\r\n]+\r?\n=+[ \t]*(?:\r?\n|$)/.test(body);
    this.view.containerEl.classList.toggle("emberly-topic-has-heading", hasHeading);
    this.view.containerEl.classList.toggle("emberly-topic-details-visible", this.detailsVisible);
    this.detailsButton.setAttribute("aria-expanded", String(this.detailsVisible));
    const label = this.detailsVisible ? "Hide note details" : "Show note details";
    this.detailsButton.setAttribute("aria-label", label);
    this.detailsButton.setAttribute("title", label);
  }

  showFile(navigation: TopicPaneNavigation = {}): void {
    this.returnTopic = navigation.returnTopic;
    this.update();
    this.setSection(navigation.section ?? (this.rootMap ? "settings" : "notes"));
  }

  private createTab(label: string, section: TopicPaneSection): HTMLButtonElement {
    const button = this.tabs.createEl("button", { text: label, attr: { role: "tab", type: "button" } });
    button.addEventListener("click", () => this.setSection(section));
    return button;
  }

  private setSection(section: TopicPaneSection): void {
    this.section = section === "settings" ? (this.rootMap ? "settings" : "notes")
      : section === "resources" ? (this.canHaveResources ? "resources" : this.rootMap ? "settings" : "notes") : "notes";
    if (this.section === "resources" && this.view.file) {
      this.updateResources(this.view.file.basename);
    }
    this.updateSection();
  }

  private updateSection(): void {
    const resources = this.canHaveResources && this.section === "resources";
    const settings = Boolean(this.rootMap) && this.section === "settings";
    this.view.containerEl.classList.toggle("emberly-map-show-settings", settings);
    this.mapSettings.container.hidden = !settings;
    this.view.containerEl.classList.toggle("emberly-topic-show-resources", resources);
    this.resourcePanel.hidden = !resources;
    this.resourceCreate.update();
    for (const [button, active] of [[this.notesButton, !resources && !settings], [this.resourcesButton, resources], [this.settingsButton, settings]] as const) {
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
  }

  private updateResources(title: string): void {
    const model = this.index.resourcesForTopic(this.currentPath, this.view.getViewData());
    this.resourcesButton.setText(`Resources (${model.resources.length})`);
    const signature = JSON.stringify([title, model]);
    if (signature === this.resourceSignature) return;
    this.resourceSignature = signature;
    const focusedPath = this.resourceList.querySelector<HTMLElement>(":focus")?.dataset.resourcePath;
    const scrollTop = this.resourcePanel.scrollTop;
    this.resourceList.empty();
    if (model.issues.length) this.resourceList.createDiv({ cls: "emberly-warning", text: model.issues.join(" "), attr: { role: "status" } });
    if (!model.resources.length) {
      const empty = this.resourceList.createDiv({ cls: "emberly-resource-empty" });
      setIcon(empty.createDiv(), "library");
      empty.createEl("p", { text: model.issues.length ? "Check resource ownership in note Details, or re-export this map." : "No resources on this topic yet." });
    }
    for (const resource of model.resources) this.renderResource(resource);
    this.resourcePanel.scrollTop = scrollTop;
    if (focusedPath) Array.from(this.resourceList.querySelectorAll<HTMLButtonElement>("[data-resource-path]"))
      .find((button) => button.dataset.resourcePath === focusedPath)?.focus({ preventScroll: true });
  }

  private renderResource(resource: TopicResource): void {
    const button = this.resourceList.createEl("button", { cls: "emberly-resource-row", attr: { type: "button", "aria-label": `Open resource note: ${resource.title}` } });
    button.dataset.resourcePath = resource.path;
    const thumbnail = button.createSpan({ cls: "emberly-resource-thumbnail" });
    const fallback = resource.kind === "link" ? onlinePreview : offlinePreview;
    const image = thumbnail.createEl("img", { attr: { alt: "", loading: "lazy", decoding: "async" } });
    image.addEventListener("error", () => { if (image.src !== fallback) image.src = fallback; });
    image.src = resource.thumbnail ?? fallback;
    const text = button.createSpan({ cls: "emberly-resource-copy" });
    text.createSpan({ cls: "emberly-resource-title", text: resource.title });
    let description = resource.kind === "link" ? "Web link" : resource.kind === "image" ? "Image" : resource.kind === "file" ? "Attachment" : "Note";
    // URL is display-only. Opening a card always opens the local Markdown note.
    try { if (resource.url) description = new URL(resource.url).hostname || description; } catch { /* Keep the resource kind for malformed URLs. */ }
    text.createSpan({ cls: "emberly-resource-description", text: description });
    if (resource.tags.length) {
      const tags = text.createSpan({ cls: "emberly-resource-tags" });
      for (const tag of resource.tags.slice(0, 4)) tags.createSpan({ text: tag });
    }
    button.addEventListener("click", () => {
      const returnTopic = this.view.file;
      if (returnTopic) this.navigate(resource.path, { returnTopic });
    });
  }

  private navigate(path: string, navigation: TopicPaneNavigation): void {
    void this.openFile(path, navigation).catch((error) => {
      console.error("Could not open Emberly resource note", error);
      new Notice("Could not open this note. Its Markdown files have not been changed.");
    });
  }

  dispose(): void {
    this.stopMove();
    this.detailsButton.removeEventListener("keydown", this.onKeyDown);
    this.detailsButton.remove();
    this.header.dispose();
    this.resourceHeader.dispose();
    this.resourceCreate.dispose();
    this.mapSettings.dispose();
    this.chrome.remove();
    this.resourcePanel.remove();
    this.view.containerEl.removeClass("emberly-topic-pane", "emberly-topic-has-heading", "emberly-topic-details-visible", "emberly-topic-show-resources", "emberly-topic-with-header", "emberly-resource-pane", "emberly-map-show-settings");
  }

  private createDetailsButton(): HTMLElement {
    const button = this.view.addAction("sliders-horizontal", "Show note details", () => this.toggleDetails());
    button.addClass("emberly-topic-details-toggle");
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.createSpan({ text: "Details" });
    button.addEventListener("keydown", this.onKeyDown);
    return button;
  }

  private startMove(file: TFile): void {
    this.stopMove();
    const identity = resourceIdentity(this.index.propertiesFor(file));
    if (!identity) return;
    try {
      this.moveSession = this.beginMove(file, (busy, message) => this.movePicker?.update(busy, message), () => this.stopMove());
      this.view.containerEl.addClass("emberly-resource-moving");
      this.movePicker = new ResourceMovePicker(this.chrome, identity.mapId, () => this.index.maps(),
        (mapId, topicId) => this.moveSession?.choose(mapId, topicId), () => this.stopMove());
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
  }
  private stopMove(): void {
    const session = this.moveSession;
    this.moveSession = undefined;
    this.movePicker?.dispose(); this.movePicker = undefined;
    this.view.containerEl.removeClass("emberly-resource-moving");
    session?.cancel();
  }

  private toggleDetails(): void {
    this.setSection("notes");
    this.detailsVisible = !this.detailsVisible;
    this.updatePresentation();
  }
}
