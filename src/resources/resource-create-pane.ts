import { Notice, setIcon } from "obsidian";
import { resourceFileError, type ResourceCreateResult, type ResourceDraft, type ResourceTarget } from "./resource-create";
import { resourceWebUrl } from "./resource-properties";

type CreationTab = "online" | "offline";

/** Original New Resource flow, scoped to the map-owned native editor pane. */
export class ResourceCreatePane {
  readonly container: HTMLElement;
  private readonly page: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly destination: HTMLElement;
  private readonly tabs = new Map<CreationTab, HTMLButtonElement>();
  private readonly online: HTMLFormElement;
  private readonly offline: HTMLFormElement;
  private readonly link: HTMLInputElement;
  private readonly onlineName: HTMLInputElement;
  private readonly offlineName: HTMLInputElement;
  private readonly source: HTMLInputElement;
  private readonly description: HTMLTextAreaElement;
  private readonly input: HTMLInputElement;
  private readonly fileList: HTMLElement;
  private readonly browse: HTMLButtonElement;
  private readonly clearFiles: HTMLButtonElement;
  private readonly onlineSubmit: HTMLButtonElement;
  private readonly offlineSubmit: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly formStatus: HTMLElement;
  private tab: CreationTab = "online";
  private target: ResourceTarget | undefined;
  private files: File[] = [];
  private generation = 0;
  private pickerGeneration: number | undefined;
  private saving = false;
  private disposed = false;
  private dragDepth = 0;

  constructor(
    parent: HTMLElement,
    private readonly host: HTMLElement,
    private readonly getTarget: () => ResourceTarget | undefined,
    private readonly save: (target: ResourceTarget, draft: ResourceDraft) => Promise<ResourceCreateResult>,
    private readonly onCreated: (target: ResourceTarget, path?: string) => void | Promise<void>,
  ) {
    this.container = parent.createDiv({ cls: "emberly-resource-upload" });
    this.button = this.container.createEl("button", { cls: "emberly-resource-upload-button", attr: { type: "button" } });
    setIcon(this.button.createSpan(), "plus"); this.button.createSpan({ text: "Add resource" });
    this.button.addEventListener("click", () => this.start());
    this.status = this.container.createDiv({ cls: "emberly-resource-upload-status", attr: { role: "status", "aria-live": "polite" } });
    this.page = parent.createDiv({ cls: "emberly-resource-create-page", attr: { "aria-label": "New resource" } });
    this.page.hidden = true;
    const bar = this.page.createDiv({ cls: "emberly-resource-bar" });
    const back = bar.createEl("button", { attr: { type: "button", "aria-label": "Back to topic resources", title: "Back to topic resources" } });
    setIcon(back, "arrow-left"); back.addEventListener("click", () => this.close(true));
    bar.createDiv({ cls: "emberly-resource-bar-title", text: "New Resource" });
    this.destination = this.page.createDiv({ cls: "emberly-resource-create-destination" });
    const tabs = this.page.createDiv({ cls: "emberly-topic-tabs", attr: { role: "tablist", "aria-label": "Resource type" } });
    const id = `emberly-create-${crypto.randomUUID()}`;
    for (const [tab, label] of [["online", "Online"], ["offline", "Offline"]] as const) {
      const button = tabs.createEl("button", { text: label, attr: { type: "button", role: "tab", id: `${id}-${tab}-tab`, "aria-controls": `${id}-${tab}` } });
      button.addEventListener("click", () => this.selectTab(tab)); this.tabs.set(tab, button);
    }
    tabs.addEventListener("keydown", (event) => {
      if (this.saving || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      this.selectTab(event.key === "Home" ? "online" : event.key === "End" ? "offline" : this.tab === "online" ? "offline" : "online");
      this.tabs.get(this.tab)?.focus();
    });
    this.online = this.form(id, "online", "Add Online Resource", "Paste the link to an online article, video, course, or whatever, and save it for later reference.");
    this.link = this.field(this.online, "Link", "https://…");
    this.link.inputMode = "url"; this.link.autocapitalize = "off"; this.link.spellcheck = false;
    this.onlineName = this.field(this.online, "Resource name (optional)", "Uses the website name if left empty");
    this.onlineSubmit = this.submitButton(this.online);
    this.offline = this.form(id, "offline", "Add Offline Resource", "Save a book, document, image, video, or any other file. You can also create a resource without an attachment.");
    this.offlineName = this.field(this.offline, "Resource name", "Name of your resource");
    this.source = this.field(this.offline, "Source (optional)", "Author, publication, or where you found it");
    const descriptionLabel = this.offline.createEl("label", { cls: "emberly-resource-create-field" });
    descriptionLabel.createSpan({ text: "Description (optional)" });
    this.description = descriptionLabel.createEl("textarea", { attr: { rows: "3" } });
    this.browse = this.offline.createEl("button", { cls: "emberly-resource-file-picker", attr: { type: "button" } });
    setIcon(this.browse.createSpan(), "upload");
    this.browse.createSpan({ text: "Drag and release files you want to attach" });
    this.browse.createSpan({ cls: "emberly-resource-file-browse", text: "Click to browse" });
    this.input = this.offline.createEl("input", { type: "file", attr: { multiple: "", "aria-label": "Choose resource files" } });
    // No accept filter: documents, archives, media, code and unknown types all work.
    this.input.hidden = true;
    this.browse.addEventListener("click", () => {
      if (!this.target || this.saving) return;
      this.pickerGeneration = this.generation; this.input.value = ""; this.input.click();
    });
    this.input.addEventListener("cancel", () => { this.pickerGeneration = undefined; });
    this.input.addEventListener("change", () => {
      const generation = this.pickerGeneration, files = Array.from(this.input.files ?? []);
      this.pickerGeneration = undefined; this.input.value = "";
      if (generation === this.generation && this.target && files.length) this.chooseFiles(files);
    });
    this.fileList = this.offline.createDiv({ cls: "emberly-resource-selected-files", attr: { "aria-live": "polite" } });
    this.clearFiles = this.offline.createEl("button", { cls: "emberly-resource-clear-files", text: "Remove attachments", attr: { type: "button" } });
    this.clearFiles.addEventListener("click", () => this.chooseFiles([]));
    this.offline.createDiv({ cls: "emberly-resource-create-help", text: "All file types · up to 20 files / 100 MiB total. Each file becomes its own resource. Files are copied into this map’s Assets folder." });
    this.offlineSubmit = this.submitButton(this.offline);
    this.formStatus = this.page.createDiv({ cls: "emberly-resource-create-status", attr: { role: "status", "aria-live": "polite" } });
    for (const form of [this.online, this.offline]) {
      form.addEventListener("submit", (event) => { event.preventDefault(); void this.create(); });
      form.addEventListener("input", () => { this.link.removeAttribute("aria-invalid"); this.updateButtons(); });
    }
    host.addEventListener("dragenter", this.dragEnter, true);
    host.addEventListener("dragover", this.dragOver, true);
    host.addEventListener("dragleave", this.dragLeave, true);
    host.addEventListener("drop", this.drop, true);
    host.addEventListener("paste", this.paste, true);
  }

  private form(id: string, tab: CreationTab, heading: string, copy: string): HTMLFormElement {
    const panel = this.page.createDiv({ attr: { role: "tabpanel", id: `${id}-${tab}`, "aria-labelledby": `${id}-${tab}-tab` } });
    const form = panel.createEl("form", { cls: "emberly-resource-create-form" });
    form.createEl("h3", { text: heading });
    form.createEl("p", { cls: "emberly-resource-create-intro", text: copy });
    return form;
  }
  private field(form: HTMLFormElement, name: string, placeholder: string): HTMLInputElement {
    const label = form.createEl("label", { cls: "emberly-resource-create-field" });
    label.createSpan({ text: name });
    return label.createEl("input", { type: "text", attr: { placeholder } });
  }
  private submitButton(form: HTMLFormElement): HTMLButtonElement {
    return form.createEl("button", { cls: "emberly-resource-create-submit mod-cta", text: "Add Resource", attr: { type: "submit" } });
  }

  private start(tab: CreationTab = "online"): void {
    const target = this.getTarget();
    if (!target || this.saving || this.disposed) return;
    this.generation++; this.target = target; this.files = [];
    this.online.reset(); this.offline.reset(); this.link.removeAttribute("aria-invalid");
    this.status.setText(""); this.formStatus.setText(""); this.fileList.empty();
    this.destination.setText(`Adding to ${target.file.basename}`);
    this.page.hidden = false; this.host.addClass("emberly-resource-creating");
    this.container.parentElement!.scrollTop = 0;
    this.selectTab(tab); (tab === "online" ? this.link : this.offlineName).focus();
  }
  private close(focus = false): void {
    this.generation++; this.target = undefined; this.pickerGeneration = undefined;
    this.files = []; this.input.value = ""; this.fileList.empty();
    this.page.hidden = true; this.host.removeClass("emberly-resource-creating"); this.resetDrag();
    if (focus) this.button.focus();
  }
  private selectTab(tab: CreationTab): void {
    this.tab = tab;
    this.online.parentElement!.hidden = tab !== "online";
    this.offline.parentElement!.hidden = tab !== "offline";
    for (const [key, button] of this.tabs) {
      button.setAttribute("aria-selected", String(key === tab)); button.tabIndex = key === tab ? 0 : -1;
    }
    this.formStatus.setText(""); this.updateButtons();
  }
  private chooseFiles(files: File[]): void {
    if (this.saving) return;
    const error = resourceFileError(files);
    if (error) { this.formStatus.setText(error); new Notice(error); return; }
    const previousName = this.files.length === 1 ? this.files[0]!.name : "";
    if (!this.offlineName.value.trim() || this.offlineName.value === previousName) this.offlineName.value = files.length === 1 ? files[0]!.name : "";
    this.files = files; this.fileList.empty(); this.formStatus.setText("");
    for (const file of files) {
      const row = this.fileList.createDiv(); setIcon(row.createSpan(), "paperclip");
      row.createSpan({ text: file.name });
      row.createSpan({ cls: "emberly-resource-file-size", text: file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KiB` : `${(file.size / 1024 / 1024).toFixed(1)} MiB` });
    }
    this.updateButtons();
  }
  private updateButtons(): void {
    this.button.disabled = this.saving || !this.getTarget();
    for (const input of [this.link, this.onlineName, this.offlineName, this.source, this.description, this.input, this.browse, this.clearFiles, ...this.tabs.values()]) input.disabled = this.saving;
    this.offlineName.disabled = this.saving || this.files.length > 1;
    this.offlineName.placeholder = this.files.length > 1 ? "Each resource uses its file name" : "Name of your resource";
    this.clearFiles.hidden = !this.files.length; this.browse.classList.toggle("has-files", Boolean(this.files.length));
    this.onlineSubmit.disabled = this.saving || !this.link.value.trim();
    this.offlineSubmit.disabled = this.saving || (!this.files.length && !this.offlineName.value.trim());
    this.onlineSubmit.setText(this.saving ? "Adding…" : "Add Resource");
    this.offlineSubmit.setText(this.saving ? "Adding…" : this.files.length > 1 ? `Add ${this.files.length} Resources` : "Add Resource");
    this.page.setAttribute("aria-busy", String(this.saving));
  }
  private async create(): Promise<void> {
    const target = this.target, generation = this.generation;
    if (!target || this.saving || this.disposed || !this.sameTarget(target, this.getTarget())) return;
    if (this.tab === "online" && !resourceWebUrl(this.link.value)) {
      this.formStatus.setText("Enter a valid http or https web link."); this.link.setAttribute("aria-invalid", "true"); this.link.focus(); return;
    }
    const draft: ResourceDraft = this.tab === "online" ? { kind: "link", url: this.link.value, title: this.onlineName.value }
      : { kind: "offline", files: [...this.files], title: this.offlineName.value, source: this.source.value, description: this.description.value };
    this.saving = true; this.updateButtons();
    const pending = `Adding to ${target.file.basename}…`;
    this.status.setText(pending); this.formStatus.setText(pending);
    try {
      const result = await this.save(target, draft);
      const summary = `${result.added} resource${result.added === 1 ? "" : "s"} added to ${target.file.basename}.${result.errors.length ? ` ${result.errors.length} could not be added.` : ""}`;
      const current = !this.disposed && generation === this.generation && this.sameTarget(target, this.getTarget());
      if (current) {
        this.formStatus.setText([summary, ...result.errors].join("\n"));
        if (result.added) {
          this.close();
          try { await this.onCreated(target, result.added === 1 && !result.errors.length ? result.paths[0] : undefined); }
          catch (error) { console.error("Resource saved but its pane could not open", error); new Notice("Resource saved. Reopen Resources to view it."); }
        }
      }
      if (!this.disposed) this.status.setText([summary, ...result.errors].join("\n"));
      new Notice(summary);
      if (result.errors.length) new Notice(result.errors.join("\n"), 15000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.disposed) {
        this.status.setText(message);
        if (generation === this.generation) this.formStatus.setText(message);
      }
      new Notice(`Could not add resource: ${message}`);
    } finally {
      this.saving = false;
      if (!this.disposed) this.update();
    }
  }
  private sameTarget(a: ResourceTarget, b?: ResourceTarget): boolean { return Boolean(b && a.file === b.file && a.id === b.id && a.mapId === b.mapId); }
  private acceptsDrag(event: DragEvent): boolean {
    return Boolean(this.getTarget() && event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files"));
  }
  private readonly dragEnter = (event: DragEvent): void => {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); this.dragDepth++; this.host.addClass("emberly-resource-drag-over");
  };
  private readonly dragOver = (event: DragEvent): void => {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer!.dropEffect = this.saving ? "none" : "copy";
  };
  private readonly dragLeave = (event: DragEvent): void => {
    if (!this.dragDepth) return;
    event.preventDefault(); event.stopPropagation(); if (--this.dragDepth === 0) this.host.removeClass("emberly-resource-drag-over");
  };
  private readonly drop = (event: DragEvent): void => {
    this.resetDrag();
    if (!this.acceptsDrag(event)) return;
    event.preventDefault(); event.stopPropagation();
    if (Array.from(event.dataTransfer!.items).some((item) => item.webkitGetAsEntry?.()?.isDirectory)) { new Notice("Choose files, not folders."); return; }
    this.receiveFiles(Array.from(event.dataTransfer!.files));
  };
  private readonly paste = (event: ClipboardEvent): void => {
    if (!this.getTarget() || !event.clipboardData || event.defaultPrevented) return;
    if ((event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable='true']")) return;
    const files = Array.from(event.clipboardData.files);
    if (!files.length) for (const item of Array.from(event.clipboardData.items)) {
      const file = item.kind === "file" ? item.getAsFile() : null;
      if (file) files.push(file);
    }
    if (!files.length) return;
    event.preventDefault(); event.stopPropagation(); this.receiveFiles(files);
  };
  private receiveFiles(files: File[]): void {
    if (this.saving) { new Notice("Wait for the current resource to finish saving."); return; }
    if (!files.length) { new Notice("Drop files from your computer, or use Click to browse."); return; }
    if (!this.target) this.start("offline"); else this.selectTab("offline");
    if (this.target) this.chooseFiles(files);
  }
  private resetDrag(): void { this.dragDepth = 0; this.host.removeClass("emberly-resource-drag-over"); }
  update(): void {
    if (this.target && !this.sameTarget(this.target, this.getTarget())) this.close();
    if (!this.getTarget()) this.resetDrag();
    this.updateButtons();
  }
  dispose(): void {
    this.disposed = true; this.close();
    this.host.removeEventListener("dragenter", this.dragEnter, true);
    this.host.removeEventListener("dragover", this.dragOver, true);
    this.host.removeEventListener("dragleave", this.dragLeave, true);
    this.host.removeEventListener("drop", this.drop, true);
    this.host.removeEventListener("paste", this.paste, true);
    this.container.remove(); this.page.remove();
  }
}
