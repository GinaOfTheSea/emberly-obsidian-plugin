/** Only the public DOM helpers used by our UI. Not an Obsidian editor emulator. */
export function installObsidianDom(): void {
  Object.assign(HTMLElement.prototype, {
    addClass(this: HTMLElement, ...names: string[]) { this.classList.add(...names); },
    removeClass(this: HTMLElement, ...names: string[]) { this.classList.remove(...names); },
    empty(this: HTMLElement) { this.replaceChildren(); },
    setText(this: HTMLElement, text: string) { this.textContent = text; },
    setAttr(this: HTMLElement, key: string, value: string) { this.setAttribute(key, value); },
    setCssProps(this: HTMLElement, properties: Record<string, string>) {
      for (const [property, value] of Object.entries(properties)) {
        this.style.setProperty(property, value);
      }
    },
    createEl(this: HTMLElement, tag: string, options: Record<string, unknown> = {}) {
      const element = this.ownerDocument.createElement(tag);
      if (options.cls) element.className = String(options.cls);
      if (options.text) element.textContent = String(options.text);
      for (const key of ["type", "value", "placeholder"] as const) {
        if (options[key] !== undefined) element.setAttribute(key, String(options[key]));
      }
      for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, String(value));
      this.append(element);
      return element;
    },
    createDiv(this: HTMLElement, options: DomElementInfo = {}) { return this.createEl("div", options); },
    createSpan(this: HTMLElement, options: DomElementInfo = {}) { return this.createEl("span", options); },
  });
}
