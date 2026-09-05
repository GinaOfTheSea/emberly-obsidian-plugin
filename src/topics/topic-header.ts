import { Notice, setIcon, type TFile } from "obsidian";
import { colorHex, readTopicAppearance, TOPIC_COLORS, type TopicAppearance, type TopicAppearanceChange, type TopicIdentity } from "./topic-appearance";

type Control = "color" | "rating" | "plan";
interface HeaderTopic extends TopicIdentity, TopicAppearance { file: TFile; title: string; }

/** Emberly's centered topic header around, not inside, the native editor. */
export class TopicHeader {
  readonly container: HTMLElement;
  private readonly title: HTMLElement;
  private readonly buttons: Record<Control, HTMLButtonElement>;
  private readonly popup: HTMLElement;
  private readonly status: HTMLElement;
  private topic: HeaderTopic | undefined;
  private active: Control | undefined;
  private generation = 0;
  private saving = false;
  private popupDocument: Document | undefined;
  private popupObserver: ResizeObserver | undefined;
  private readonly dismiss = (event: Event): void => {
    const path = event.composedPath();
    if (!path.includes(this.container) && !path.includes(this.popup)) this.close();
  };
  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.active) {
      event.preventDefault(); event.stopPropagation(); this.close(true);
    }
  };
  private readonly reposition = (): void => {
    const doc = this.popupDocument, win = doc?.defaultView;
    if (!this.active || !doc || !win) return;
    if (!this.container.isConnected || this.container.ownerDocument !== doc) { this.close(); return; }
    const anchor = this.buttons[this.active].getBoundingClientRect();
    if (!anchor.width || !anchor.height) { this.close(); return; }
    const viewport = win.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? win.innerWidth, height = viewport?.height ?? win.innerHeight;
    if (anchor.bottom < top || anchor.top > top + height || anchor.right < left || anchor.left > left + width) { this.close(); return; }
    const margin = 8, gap = 6;
    const popupWidth = Math.max(0, Math.min(356, width - margin * 2));
    // scrollHeight preserves the content's required height when an earlier
    // position constrained it. Measure after width so wrapped labels count.
    const desiredHeight = Math.min(360, this.popup.scrollHeight + 2);
    const below = Math.max(0, top + height - anchor.bottom - gap - margin);
    const above = Math.max(0, anchor.top - top - gap - margin);
    const upwards = below < desiredHeight && above > below;
    const popupHeight = Math.min(desiredHeight, upwards ? above : below);
    this.popup.setCssProps({
      "--emberly-popup-width": `${popupWidth}px`,
      "--emberly-popup-height": `${popupHeight}px`,
      "--emberly-popup-left": `${Math.max(left + margin, Math.min(left + width - popupWidth - margin, anchor.left + anchor.width / 2 - popupWidth / 2))}px`,
      "--emberly-popup-top": `${upwards ? anchor.top - gap - popupHeight : anchor.bottom + gap}px`,
    });
  };

  constructor(
    parent: HTMLElement,
    private readonly save: (file: TFile, identity: TopicIdentity, change: TopicAppearanceChange) => Promise<TopicAppearance>,
    private readonly allowInherit: (file: TFile) => boolean,
  ) {
    this.container = parent.createDiv({ cls: "emberly-topic-header" });
    this.title = this.container.createEl("h2", { cls: "emberly-topic-header-title" });
    const controls = this.container.createDiv({ cls: "emberly-topic-header-controls" });
    this.buttons = Object.fromEntries((["color", "rating", "plan"] as const).map((control) => {
      const button = controls.createEl("button", { attr: { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" } });
      button.addEventListener("click", () => this.active === control ? this.close() : this.open(control));
      return [control, button];
    })) as Record<Control, HTMLButtonElement>;
    // The popup is attached to the owning window's body only while open. A
    // fixed child inside the header would still be trapped by pane containment.
    this.popup = this.container.createDiv({ cls: "emberly-topic-header-popup" });
    this.popup.remove();
    this.popup.setAttribute("role", "dialog");
    this.popup.id = `emberly-topic-settings-${crypto.randomUUID()}`;
    for (const button of Object.values(this.buttons)) button.setAttribute("aria-controls", this.popup.id);
    this.popup.hidden = true;
    this.status = this.container.createDiv({ cls: "emberly-topic-header-status", attr: { role: "status", "aria-live": "polite" } });
    this.container.addEventListener("keydown", this.keydown);
    this.popup.addEventListener("keydown", this.keydown);
  }

  update(file: TFile | null, properties: Record<string, unknown> = {}): void {
    const valid = file && properties.emberly === "topic" && properties["emberly-format"] === 2
      && typeof properties["emberly-id"] === "string" && typeof properties["emberly-map"] === "string";
    const appearance = readTopicAppearance(properties);
    const changed = file !== this.topic?.file || properties["emberly-id"] !== this.topic?.id || properties["emberly-map"] !== this.topic?.mapId;
    if (changed || !valid) {
      this.generation++; this.close(); this.saving = false; this.status.setText("");
    }
    if (this.active && this.topic && (appearance.color !== this.topic.color || appearance.rating !== this.topic.rating || appearance.state !== this.topic.state)) this.close();
    this.topic = valid ? {
      file, id: properties["emberly-id"] as string, mapId: properties["emberly-map"] as string,
      title: file.basename,
      ...appearance,
    } : undefined;
    this.container.hidden = !this.topic;
    this.render();
  }

  private render(): void {
    const topic = this.topic;
    if (!topic) return;
    this.title.setText(topic.title);
    for (const control of ["color", "rating", "plan"] as const) {
      const button = this.buttons[control];
      button.empty(); button.disabled = this.saving;
      button.setAttribute("aria-expanded", String(control === this.active));
      if (control === "color" && topic.color >= 0) {
        const swatch = button.createSpan({ cls: "emberly-topic-color-chip" });
        swatch.setCssProps({ "--emberly-topic-color": colorHex(topic.color) });
        button.setAttribute("aria-label", `Change color, ${colorHex(topic.color)}`);
      } else if (control === "rating" && topic.rating > 0) {
        const dots = button.createSpan({ cls: "emberly-topic-rating-dots" });
        for (let i = 0; i < topic.rating; i++) setIcon(dots.createSpan(), "circle");
        button.setAttribute("aria-label", `Change rating, ${topic.rating} out of 5`);
      } else if (control === "plan" && (topic.state & 3) !== 0) {
        const plan = topic.state & 3;
        this.planLabel(button, plan);
        button.setAttribute("aria-label", `Change plan, ${plan === 2 ? "In focus" : plan === 1 ? "Up next" : "Unknown plan"}`);
      } else {
        const label = `Add ${control}`;
        button.createSpan({ text: label }); button.setAttribute("aria-label", label);
      }
      setIcon(button.createSpan({ cls: "emberly-topic-header-chevron" }), "chevron-down");
    }
  }

  private open(control: Control): void {
    if (!this.topic || this.saving) return;
    this.close(); this.active = control; this.popup.empty(); this.popup.hidden = false;
    this.popup.setAttribute("aria-label", `Topic ${control}`);
    this.popup.createDiv({ cls: "emberly-topic-popup-label", text: control === "color" ? "Topic color" : control === "rating" ? "Topic rating" : "Learning plan" });
    if (control === "color") this.renderColors();
    else if (control === "rating") this.renderRating();
    else this.renderPlans();
    const doc = this.container.ownerDocument;
    this.popupDocument = doc;
    doc.body.append(this.popup);
    doc.addEventListener("pointerdown", this.dismiss, true);
    doc.addEventListener("focusin", this.dismiss);
    doc.addEventListener("scroll", this.reposition, true);
    doc.defaultView?.addEventListener("resize", this.reposition);
    doc.defaultView?.visualViewport?.addEventListener("resize", this.reposition);
    doc.defaultView?.visualViewport?.addEventListener("scroll", this.reposition);
    this.popupObserver = new ResizeObserver(this.reposition);
    this.popupObserver.observe(this.container);
    this.popupObserver.observe(this.popup);
    this.render();
    this.reposition();
    if (this.active) this.popup.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
  }

  private renderColors(): void {
    const palette = this.popup.createDiv({ cls: "emberly-topic-color-palette", attr: { role: "group", "aria-label": "Emberly colors" } });
    for (const hex of TOPIC_COLORS) {
      const value = Number.parseInt(hex.slice(1), 16);
      const button = palette.createEl("button", { attr: { type: "button", "aria-label": hex, title: hex, "aria-pressed": String(this.topic!.color === value) } });
      button.setCssProps({ "--emberly-topic-color": hex });
      button.addEventListener("click", () => void this.commit({ color: value }));
    }
    const custom = this.popup.createDiv({ cls: "emberly-topic-custom-color" });
    const picker = custom.createEl("input", { type: "color", value: colorHex(this.topic!.color >= 0 ? this.topic!.color : 0x009aa0), attr: { "aria-label": "Custom topic color" } });
    const hex = custom.createEl("input", { type: "text", value: picker.value, attr: { "aria-label": "Hex color", maxlength: "7", spellcheck: "false" } });
    picker.addEventListener("input", () => { hex.value = picker.value; hex.removeAttribute("aria-invalid"); });
    const apply = custom.createEl("button", { text: "Apply", attr: { type: "button" } });
    const applyColor = (): void => {
      const match = /^#?([\da-f]{6})$/i.exec(hex.value.trim());
      if (!match) { hex.setAttribute("aria-invalid", "true"); hex.focus(); this.status.setText("Enter a six-digit hex color, such as #009AA0."); return; }
      void this.commit({ color: Number.parseInt(match[1]!, 16) });
    };
    apply.addEventListener("click", applyColor);
    hex.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); applyColor(); } });
    if (this.allowInherit(this.topic!.file)) {
      const inherit = this.popup.createEl("button", { cls: "emberly-topic-popup-action", text: "Follow parent color", attr: { type: "button", "aria-pressed": String(this.topic!.color < 0) } });
      inherit.addEventListener("click", () => void this.commit({ color: -1 }));
    }
  }

  private renderRating(): void {
    const rating = this.popup.createDiv({ cls: "emberly-topic-rating-picker", attr: { role: "group", "aria-label": "Rating out of five" } });
    for (let value = 1; value <= 5; value++) {
      const button = rating.createEl("button", { attr: { type: "button", "aria-label": `${value} out of 5`, "aria-pressed": String(this.topic!.rating === value) } });
      button.classList.toggle("is-filled", value <= this.topic!.rating);
      setIcon(button, "circle");
      button.addEventListener("click", () => void this.commit({ rating: this.topic!.rating === value ? 0 : value }));
    }
    this.popup.createEl("button", { cls: "emberly-topic-popup-action", text: "Clear rating", attr: { type: "button" } })
      .addEventListener("click", () => void this.commit({ rating: 0 }));
  }

  private renderPlans(): void {
    for (const plan of [2, 1, 0] as const) {
      const button = this.popup.createEl("button", { cls: "emberly-topic-plan-option", attr: { type: "button", "aria-pressed": String((this.topic!.state & 3) === plan) } });
      this.planLabel(button, plan);
      button.addEventListener("click", () => void this.commit({ plan }));
    }
  }

  private planLabel(parent: HTMLElement, plan: number): void {
    const icon = parent.createSpan({ cls: plan === 2 ? "emberly-topic-plan-heart" : "emberly-topic-plan-icon" });
    setIcon(icon, plan === 2 ? "heart" : plan === 1 ? "flag" : "circle-slash");
    parent.createSpan({ text: plan === 2 ? "In focus" : plan === 1 ? "Up next" : plan === 0 ? "No plan" : "Unknown plan" });
  }

  private async commit(change: TopicAppearanceChange): Promise<void> {
    const topic = this.topic;
    if (!topic || this.saving) return;
    const generation = this.generation;
    this.close(true); this.saving = true; this.status.setText("Saving…"); this.render();
    try {
      const saved = await this.save(topic.file, topic, change);
      if (generation === this.generation && this.topic) { Object.assign(this.topic, saved); this.status.setText(""); }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (generation === this.generation) this.status.setText(`Not saved: ${message}`);
      new Notice(`Could not save topic settings: ${message}`);
    } finally {
      if (generation === this.generation) { this.saving = false; this.render(); }
    }
  }

  close(restoreFocus = false): void {
    const previous = this.active;
    this.active = undefined; this.popup.hidden = true;
    const doc = this.popupDocument;
    this.popupDocument = undefined;
    this.popupObserver?.disconnect(); this.popupObserver = undefined;
    doc?.removeEventListener("pointerdown", this.dismiss, true);
    doc?.removeEventListener("focusin", this.dismiss);
    doc?.removeEventListener("scroll", this.reposition, true);
    doc?.defaultView?.removeEventListener("resize", this.reposition);
    doc?.defaultView?.visualViewport?.removeEventListener("resize", this.reposition);
    doc?.defaultView?.visualViewport?.removeEventListener("scroll", this.reposition);
    this.popup.remove();
    this.render();
    if (restoreFocus && previous) this.buttons[previous].focus();
  }

  dispose(): void { this.generation++; this.close(); this.container.remove(); }
}
