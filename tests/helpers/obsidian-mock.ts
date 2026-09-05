// The runtime is provided by Obsidian, not its npm type package. Accept real
// YAML from plugin creation paths as well as the fixture's JSON-shaped YAML.
import { parse } from "yaml";
export const parseYaml = (value: string): unknown => parse(value);
export const stringifyYaml = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
export const parseLinktext = (link: string): { path: string; subpath: string } => {
  const index = link.indexOf("#");
  return index < 0 ? { path: link, subpath: "" } : { path: link.slice(0, index), subpath: link.slice(index) };
};
export class TFile {
  stat = { mtime: 0, ctime: 0, size: 0 };
  constructor(public path: string) {}
  get name(): string { return this.path.split("/").at(-1)!; }
  get basename(): string { return this.name.replace(/\.[^.]+$/, ""); }
  get extension(): string { return this.name.includes(".") ? this.name.split(".").at(-1)! : ""; }
}
export class TFolder {
  children: (TFile | TFolder)[] = [];
  constructor(public path: string) {}
}
export class Notice {}
export const setIcon = (element: HTMLElement, name: string): void => {
  element.setAttribute("data-icon", name);
};
export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.settingEl = parent.createDiv({ cls: "setting-item" });
    this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
  }

  setName(name: string): this {
    this.nameEl.setText(name);
    return this;
  }

  addToggle(callback: (toggle: {
    toggleEl: HTMLInputElement;
    setValue(value: boolean): unknown;
    setDisabled(value: boolean): unknown;
    onChange(next: (value: boolean) => void): unknown;
  }) => void): this {
    const toggleEl = this.controlEl.createEl("input", { attr: { type: "checkbox" } });
    let change = (_value: boolean): void => {};
    toggleEl.addEventListener("change", () => change(toggleEl.checked));
    const toggle = {
      toggleEl,
      setValue(value: boolean) { toggleEl.checked = value; return toggle; },
      setDisabled(value: boolean) { toggleEl.disabled = value; return toggle; },
      onChange(next: (value: boolean) => void) { change = next; return toggle; },
    };
    callback(toggle);
    return this;
  }
}
