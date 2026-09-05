import type { EmberlyMap } from "../shared/types";

/** A small sidebar picker; map clicks call the same choose callback. */
export class ResourceMovePicker {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly maps: HTMLSelectElement;
  private readonly results: HTMLElement;
  private readonly status: HTMLElement;
  private readonly cancelButton: HTMLButtonElement;
  private busy = false;
  constructor(parent: HTMLElement, currentMap: string, private readonly getMaps: () => EmberlyMap[],
    private readonly choose: (mapId: string, topicId: string) => void, cancel: () => void) {
    this.element = parent.createDiv({ cls: "emberly-resource-move-picker" });
    this.element.createEl("h3", { text: "Move resource" });
    this.element.createEl("p", { text: "Search for a topic, or click a topic on an open map." });
    this.element.createEl("p", { text: "Across maps, attachments are copied too. Enable Obsidian’s ‘Automatically update internal links’ to keep links from other notes updated." });
    this.maps = this.element.createEl("select", { attr: { "aria-label": "Destination map" } });
    for (const map of this.getMaps().filter((map) => map.format === 2 && !map.issues.length)) {
      this.maps.createEl("option", { text: `${map.title} — ${map.folder}`, value: map.id });
    }
    this.maps.value = currentMap;
    this.input = this.element.createEl("input", { type: "search", placeholder: "Search topics…", attr: { "aria-label": "Destination topic" } });
    this.results = this.element.createDiv({ cls: "emberly-resource-move-results", attr: { "aria-label": "Matching topics" } });
    this.status = this.element.createDiv({ attr: { role: "status", "aria-live": "polite" } });
    this.cancelButton = this.element.createEl("button", { text: "Cancel", attr: { type: "button" } });
    this.cancelButton.addEventListener("click", cancel);
    this.input.addEventListener("input", () => this.render());
    this.maps.addEventListener("change", () => this.render());
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
      if (event.key === "ArrowDown" && event.target === this.input) {
        event.preventDefault(); this.results.querySelector<HTMLButtonElement>("button")?.focus();
      }
      if (event.key === "Enter" && event.target === this.input && !this.busy) {
        event.preventDefault(); this.results.querySelector<HTMLButtonElement>("button")?.click();
      }
    });
    this.render(); this.input.focus();
  }
  update(busy: boolean, message = ""): void {
    this.busy = busy; this.status.setText(message);
    this.input.disabled = busy; this.maps.disabled = busy; this.cancelButton.disabled = busy;
    for (const button of Array.from(this.results.querySelectorAll<HTMLButtonElement>("button"))) button.disabled = busy;
  }
  private render(): void {
    const map = this.getMaps().find((map) => map.id === this.maps.value);
    this.results.empty();
    if (!map || map.issues.length) return;
    const labels = map.nodes.filter((node) => node.parentId !== null).map((node) => {
      const ancestors: string[] = [], visited = new Set<string>();
      let parent = node.parentId;
      while (parent && !visited.has(parent)) {
        visited.add(parent);
        const ancestor = map.nodes.find((candidate) => candidate.id === parent);
        if (!ancestor) break;
        ancestors.unshift(ancestor.title); parent = ancestor.parentId;
      }
      return { node, label: [...ancestors, node.title].join(" / ") };
    });
    const query = this.input.value.trim().toLowerCase();
    const matches = labels.filter(({ label }) => label.toLowerCase().includes(query));
    for (const { node, label } of matches.slice(0, 100)) {
      const button = this.results.createEl("button", { text: label, attr: { type: "button", title: node.path } });
      button.addEventListener("click", () => { if (!this.busy) this.choose(map.id, node.id); });
    }
    if (!matches.length) this.results.createEl("p", { text: "No matching topics." });
    if (matches.length > 100) this.results.createEl("p", { text: "Showing 100 topics. Type to narrow the list." });
  }
  dispose(): void { this.element.remove(); }
}
