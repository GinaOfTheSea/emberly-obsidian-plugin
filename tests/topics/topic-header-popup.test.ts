// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { TopicHeader } from "../../src/topics/topic-header";
import { installObsidianDom } from "../helpers/obsidian-dom";

describe("topic settings floating outside the scrollable header", () => {
  let header: TopicHeader, chrome: HTMLElement;
  let save: ReturnType<typeof vi.fn>;
  const properties = { emberly: "topic", "emberly-format": 2, "emberly-id": "topic", "emberly-map": "map", title: "Equipment" };
  const file = Object.assign(new TFile(), { path: "Workshop/Topics/Equipment.md" });
  const popup = () => document.body.querySelector<HTMLElement>(".emberly-topic-header-popup");
  const trigger = (control: string) => header.container.querySelector<HTMLButtonElement>(`[aria-label="Add ${control}"]`)!;
  const open = (control: string) => { trigger(control).click(); return popup()!; };

  beforeEach(() => {
    installObsidianDom();
    chrome = document.body.createDiv({ cls: "emberly-topic-chrome" });
    chrome.style.overflow = "auto";
    chrome.style.height = "120px";
    save = vi.fn(async () => ({ color: -1, rating: 0, state: 0 }));
    header = new TopicHeader(chrome, save, () => true);
    header.update(file, properties);
    // DOM tests cannot measure layout. Give the real positioning code explicit
    // button/content geometry; native Electron rendering is checked separately.
    for (const control of ["color", "rating", "plan"]) {
      vi.spyOn(trigger(control), "getBoundingClientRect").mockReturnValue(new DOMRect(500, 100, 120, 32));
    }
  });
  afterEach(() => { header.dispose(); document.body.empty(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("uses the current filename despite a conflicting stored title", () => {
    header.update(file, { ...properties, title: "An obsolete title" });
    expect(header.container.querySelector("h2")?.textContent).toBe("Equipment");
  });

  it.each(["color", "rating", "plan"])("mounts %s at document level, outside header clipping", (control) => {
    const menu = open(control);
    expect(menu.parentElement).toBe(document.body);
    expect(chrome.contains(menu)).toBe(false);
    expect(menu.hidden).toBe(false);
    expect(trigger(control).getAttribute("aria-expanded")).toBe("true");
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it("keeps the popup open for pointer/focus inside, and saves a plan selection", async () => {
    const menu = open("plan");
    const option = Array.from(menu.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Up next")!;
    option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    option.focus();
    expect(popup()).toBe(menu);
    option.click();
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith(file, expect.objectContaining({ id: "topic", mapId: "map" }), { plan: 1 });
    expect(popup()).toBeNull();
  });

  it("supports rating selection and custom color input after moving outside the header", async () => {
    open("rating").querySelector<HTMLButtonElement>('[aria-label="3 out of 5"]')!.click();
    await Promise.resolve();
    expect(save).toHaveBeenLastCalledWith(file, expect.anything(), { rating: 3 });
    const menu = open("color");
    const hex = menu.querySelector<HTMLInputElement>('[aria-label="Hex color"]')!;
    hex.focus(); hex.value = "#123abc";
    expect(popup()).toBe(menu);
    hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(save).toHaveBeenLastCalledWith(file, expect.anything(), { color: 0x123abc });
  });

  it("Escape removes the popup and restores focus to its button", () => {
    const button = trigger("plan"), menu = open("plan");
    menu.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(save).not.toHaveBeenCalled();
  });

  it("closes on outside clicks/focus and never accumulates detached popups", () => {
    open("plan");
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    expect(popup()).toBeNull();
    open("rating");
    const editor = document.body.createEl("textarea"); editor.focus();
    expect(popup()).toBeNull();
    open("color"); open("plan");
    expect(document.querySelectorAll(".emberly-topic-header-popup")).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("clamps to a narrow window and flips above a button near the bottom", () => {
    vi.stubGlobal("innerWidth", 320);
    vi.stubGlobal("innerHeight", 400);
    // happy-dom has no visual viewport layout; use the owning window dimensions.
    const button = trigger("plan");
    vi.mocked(button.getBoundingClientRect).mockReturnValue(new DOMRect(250, 340, 60, 32));
    const menu = open("plan");
    Object.defineProperty(menu, "scrollHeight", { configurable: true, value: 200 });
    window.dispatchEvent(new Event("resize"));
    expect(menu.style.getPropertyValue("--emberly-popup-width")).toBe("304px");
    expect(menu.style.getPropertyValue("--emberly-popup-left")).toBe("8px");
    expect(menu.style.getPropertyValue("--emberly-popup-top")).toBe("132px");
    expect(menu.style.getPropertyValue("--emberly-popup-height")).toBe("202px");
    vi.unstubAllGlobals();
  });

  it("repositions on ancestor scroll without treating popup scrolling as dismissal", () => {
    const button = trigger("plan"), menu = open("plan");
    vi.mocked(button.getBoundingClientRect).mockReturnValue(new DOMRect(400, 200, 120, 32));
    chrome.dispatchEvent(new Event("scroll"));
    expect(menu.style.getPropertyValue("--emberly-popup-top")).toBe("238px");
    menu.dispatchEvent(new Event("scroll"));
    expect(popup()).toBe(menu);
  });

  it("topic changes and disposal remove the body portal and its listeners", () => {
    const removeDoc = vi.spyOn(document, "removeEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    open("plan");
    header.update(Object.assign(new TFile(), { path: "Other.md" }), { ...properties, "emberly-id": "other" });
    expect(popup()).toBeNull();
    open("rating"); header.dispose();
    expect(popup()).toBeNull();
    expect(removeDoc).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(removeWindow).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(save).not.toHaveBeenCalled();
  });

  it("closes when its anchor is hidden or detached instead of leaving an orphaned menu", () => {
    open("plan");
    vi.mocked(trigger("plan").getBoundingClientRect).mockReturnValue(new DOMRect());
    window.dispatchEvent(new Event("resize"));
    expect(popup()).toBeNull();
    open("color"); header.container.remove();
    window.dispatchEvent(new Event("resize"));
    expect(popup()).toBeNull();
  });
});
