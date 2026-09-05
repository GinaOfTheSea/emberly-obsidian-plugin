import { App, Modal, Notice, Setting, SuggestModal, setIcon, type TFolder } from "obsidian";
import type { EmberlyMap } from "../shared/types";

type MapPickerSuggestion = { kind: "map"; map: EmberlyMap } | { kind: "create"; name: string };

export class MapPickerModal extends SuggestModal<MapPickerSuggestion> {
  constructor(
    app: App,
    private readonly maps: EmberlyMap[],
    private readonly choose: (map: EmberlyMap) => void,
    private readonly create: (name?: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Open or create an Emberly map…");
  }
  getSuggestions(query: string): MapPickerSuggestion[] {
    const name = query.trim(), needle = name.toLocaleLowerCase();
    const maps = this.maps.filter((map) => map.title.toLocaleLowerCase().includes(needle))
      .map((map): MapPickerSuggestion => ({ kind: "map", map }));
    const exact = Boolean(name) && this.maps.some((map) => map.title.toLocaleLowerCase() === needle);
    return exact ? maps : [{ kind: "create", name }, ...maps];
  }
  renderSuggestion(suggestion: MapPickerSuggestion, element: HTMLElement): void {
    if (suggestion.kind === "create") {
      element.addClass("emberly-picker-create");
      const title = element.createDiv({ cls: "emberly-picker-title" });
      setIcon(title.createSpan({ cls: "emberly-picker-create-icon" }), "plus");
      title.createSpan({ text: suggestion.name ? `Create “${suggestion.name}”` : "New map" });
      element.createDiv({ text: suggestion.name ? "Create and open this map" : "Create a new Emberly map", cls: "emberly-picker-meta" });
      return;
    }
    element.createDiv({ text: suggestion.map.title, cls: "emberly-picker-title" });
    element.createDiv({ text: `${suggestion.map.nodes.length} topics · ${suggestion.map.folder}`, cls: "emberly-picker-meta" });
  }
  onChooseSuggestion(suggestion: MapPickerSuggestion): void {
    if (suggestion.kind === "map") this.choose(suggestion.map);
    else this.create(suggestion.name || undefined);
  }
}

export class MapFolderPickerModal extends SuggestModal<TFolder> {
  private readonly folders: TFolder[];
  constructor(app: App, currentFolder: string, private readonly choose: (folder: TFolder) => void) {
    super(app);
    const currentParent = currentFolder.includes("/") ? currentFolder.slice(0, currentFolder.lastIndexOf("/")) : "";
    const path = (folder: TFolder): string => folder.isRoot() ? "" : folder.path;
    this.folders = app.vault.getAllFolders(true).filter((folder) => {
      const candidate = path(folder);
      return candidate !== currentParent && candidate !== currentFolder && !candidate.startsWith(`${currentFolder}/`)
        && candidate !== app.vault.configDir && !candidate.startsWith(`${app.vault.configDir}/`);
    }).sort((a, b) => path(a).localeCompare(path(b), undefined, { sensitivity: "base", numeric: true }));
    this.setPlaceholder("Move map to folder…");
    this.emptyStateText = "No matching destination folders.";
  }
  getSuggestions(query: string): TFolder[] {
    const needle = query.trim().toLocaleLowerCase();
    return this.folders.filter((folder) => (folder.isRoot() ? "vault root" : `${folder.name} ${folder.path}`).toLocaleLowerCase().includes(needle));
  }
  renderSuggestion(folder: TFolder, element: HTMLElement): void {
    const title = element.createDiv({ cls: "emberly-picker-title emberly-folder-picker-title" });
    setIcon(title.createSpan({ cls: "emberly-picker-create-icon" }), "folder");
    title.createSpan({ text: folder.isRoot() ? "Vault root" : folder.name });
    element.createDiv({ text: folder.isRoot() ? "/" : folder.path, cls: "emberly-picker-meta" });
  }
  onChooseSuggestion(folder: TFolder): void { this.choose(folder); }
}

export class NameModal extends Modal {
  private value = "";
  constructor(app: App, private readonly title: string, private readonly placeholder: string, private readonly submit: (value: string) => void | Promise<void>) {
    super(app);
  }
  onOpen(): void {
    this.setTitle(this.title);
    new Setting(this.contentEl).setName("Name").addText((input) => {
      input.setPlaceholder(this.placeholder).onChange((value) => this.value = value);
      input.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void this.finish();
      });
      window.setTimeout(() => input.inputEl.focus(), 0);
    });
    new Setting(this.contentEl).addButton((button) => button.setCta().setButtonText("Create").onClick(() => void this.finish()));
  }
  private async finish(): Promise<void> {
    const value = this.value.trim();
    if (!value) return;
    this.close();
    await this.submit(value);
  }
  onClose(): void { this.contentEl.empty(); }
}

let topicInputId = 0;

/** Confirmation only: closing or Escape never performs the destructive action. */
export class TrashMapModal extends Modal {
  private settled = false;
  constructor(app: App, private readonly map: EmberlyMap, private readonly paths: string[], private readonly decide: (confirmed: boolean) => void) { super(app); }
  onOpen(): void {
    this.setTitle(`Move “${this.map.title}” to trash?`);
    this.contentEl.createEl("p", { text: `This moves the map and its ${this.paths.length - 1} topic/resource notes to Obsidian’s configured trash.` });
    this.contentEl.createEl("p", { text: "Referenced attachments in this map’s Assets folder are also moved if unused elsewhere. Shared attachments, unrelated files and folders are kept. Links from other notes to the deleted map will no longer open it." });
    const details = this.contentEl.createEl("details");
    details.createEl("summary", { text: "Notes included" });
    const list = details.createEl("ul", { cls: "emberly-map-trash-files" });
    for (const path of this.paths) list.createEl("li", { text: path });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Move to trash").setDestructive().onClick(() => {
        this.settled = true; this.decide(true); this.close();
      }));
  }
  onClose(): void { if (!this.settled) { this.settled = true; this.decide(false); } this.contentEl.empty(); }
}

/** Enter queues a name; Enter on an empty input creates the queued topics. */
export class TopicNamesModal extends Modal {
  private names: string[] = [];
  private busy = false;
  private opened = false;
  private input!: HTMLInputElement;
  private chips!: HTMLElement;
  private error!: HTMLElement;
  private createButton!: HTMLButtonElement;
  private focusTimer?: number;

  constructor(app: App, private readonly title: string, private readonly submit: (name: string) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.opened = true;
    this.setTitle(this.title);
    this.contentEl.addClass("emberly-topic-names-modal");
    const id = `emberly-topic-names-${++topicInputId}`;
    this.contentEl.createEl("label", { text: "Topic names", attr: { for: id } });
    const entry = this.contentEl.createDiv({ cls: "emberly-topic-name-entry" });
    this.chips = entry.createDiv({ cls: "emberly-topic-name-chips", attr: { role: "list", "aria-label": "Topics to create" } });
    this.input = entry.createEl("input", { attr: { id, type: "text", placeholder: "Type a name or paste a comma-separated list",
      "aria-describedby": `${id}-help`, autocomplete: "off" } });
    this.error = this.contentEl.createDiv({ cls: "emberly-topic-names-error", attr: { role: "alert" } });
    const actions = this.contentEl.createDiv({ cls: "emberly-topic-names-actions" });
    actions.createEl("small", { cls: "emberly-topic-names-help", text: "(Enter, enter)", attr: { id: `${id}-help` } });
    this.createButton = actions.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    this.createButton.addEventListener("click", () => void this.finish());
    this.input.addEventListener("input", () => this.updateButton());
    this.input.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (this.busy || !text || !/[,\r\n]/.test(text)) return;
      event.preventDefault();
      this.input.setRangeText(text, this.input.selectionStart ?? this.input.value.length,
        this.input.selectionEnd ?? this.input.value.length, "end");
      this.commitInput();
    });
    this.contentEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.target !== this.input || event.isComposing) return;
      event.preventDefault(); event.stopPropagation();
      if (event.repeat || this.busy || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (this.input.value.trim()) this.commitInput();
      else if (this.names.length) void this.finish();
    });
    this.renderChips();
    this.focusTimer = window.setTimeout(() => { if (this.opened) this.input.focus(); }, 0);
  }

  private pendingInput(): string[] { return this.input.value.split(/[,\r\n]+/).map((name) => name.trim()).filter(Boolean); }
  private commitInput(): void {
    this.names.push(...this.pendingInput());
    this.input.value = "";
    this.error.setText("");
    this.renderChips();
  }
  private updateButton(): void {
    const count = this.names.length + this.pendingInput().length;
    this.createButton.setText(this.busy ? "Creating…" : count ? `Create ${count} topic${count === 1 ? "" : "s"}` : "Create topics");
    this.createButton.disabled = this.busy || count === 0;
  }
  private renderChips(): void {
    this.chips.empty();
    this.names.forEach((name, index) => {
      const chip = this.chips.createSpan({ cls: "emberly-topic-name-chip", attr: { role: "listitem" } });
      chip.createSpan({ text: name });
      const remove = chip.createEl("button", { attr: { type: "button", "aria-label": `Remove ${name}`, title: `Remove ${name}` } });
      setIcon(remove, "x"); remove.disabled = this.busy;
      remove.addEventListener("click", () => {
        if (this.busy) return;
        this.names.splice(index, 1); this.renderChips(); this.input.focus();
      });
    });
    this.input.disabled = this.busy;
    this.contentEl.setAttribute("aria-busy", String(this.busy));
    this.updateButton();
  }
  private async finish(): Promise<void> {
    if (this.busy || !this.opened) return;
    this.commitInput();
    if (!this.names.length) { this.close(); return; }
    this.busy = true; this.renderChips();
    let created = 0;
    try {
      // Sequential saves retain input order and use the existing ID/order allocator.
      // Closing stops unstarted items; an in-flight file write is allowed to finish.
      while (this.opened && this.names.length) {
        await this.submit(this.names[0]!);
        this.names.shift(); created++;
        if (this.opened) this.renderChips();
      }
      if (this.opened) this.close();
    } catch (error) {
      if (this.opened) this.error.setText(`Could not create “${this.names[0]}”: ${error instanceof Error ? error.message : String(error)}. Remaining names are kept for retry.`);
    } finally {
      this.busy = false;
      if (this.opened) { this.renderChips(); this.input.focus(); }
      if (created) new Notice(`Created ${created} topic${created === 1 ? "" : "s"}.`);
    }
  }
  onClose(): void {
    this.opened = false;
    if (this.focusTimer !== undefined) window.clearTimeout(this.focusTimer);
    this.contentEl.empty();
  }
}
