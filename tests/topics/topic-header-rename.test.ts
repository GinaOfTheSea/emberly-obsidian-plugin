// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { TopicHeader } from "../../src/topics/topic-header";
import { installObsidianDom } from "../helpers/obsidian-dom";

describe("inline topic rename", () => {
  let header: TopicHeader, title: HTMLElement, file: TFile;
  const properties = { emberly: "topic", "emberly-format": 2, "emberly-id": "topic", "emberly-map": "map" };
  const rename = vi.fn(async (file: TFile, _identity: unknown, name: string, _path: string) => {
    Object.assign(file, { path: `Topics/${name}.md` });
  });
  const key = (key: string, isComposing = false) => title.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing, bubbles: true, cancelable: true }));
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  beforeEach(() => {
    installObsidianDom(); rename.mockClear();
    file = Object.assign(new TFile(), { path: "Topics/Herring Gull.md" });
    header = new TopicHeader(document.body, async () => ({ color: -1, rating: 0, state: 0 }), () => true, rename);
    header.update(file, properties);
    title = header.container.querySelector("h2")!;
  });
  afterEach(() => { header.dispose(); document.body.empty(); });

  it("selects the name on click and saves once on Enter, even if blurred during save", async () => {
    title.click();
    expect(document.getSelection()?.toString()).toBe("Herring Gull");
    expect(title.getAttribute("role")).toBe("textbox");
    title.textContent = "Lesser Black-backed Gull";
    key("Enter"); title.blur();
    await settle();
    expect(rename).toHaveBeenCalledExactlyOnceWith(file, expect.objectContaining({ id: "topic", mapId: "map" }), "Lesser Black-backed Gull", "Topics/Herring Gull.md");
    expect(title.textContent).toBe("Lesser Black-backed Gull");
    expect(title.getAttribute("contenteditable")).toBe("false");
  });

  it("supports keyboard activation and Escape without saving on the subsequent blur", () => {
    title.focus(); key("Enter"); title.textContent = "Discard"; key("Escape"); title.blur();
    expect(rename).not.toHaveBeenCalled();
    expect(title.textContent).toBe("Herring Gull");
  });

  it("saves when focus leaves the title and leaves the next control focused", async () => {
    title.click(); title.textContent = "Common Gull";
    const next = header.container.querySelector("button")!; next.focus();
    await settle();
    expect(rename).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(next);
  });

  it("preserves drafts across metadata refreshes and ignores composition Enter", async () => {
    title.click(); title.textContent = "カモメ";
    header.update(file, { ...properties, "emberly-color": 123 });
    key("Enter", true); await settle();
    expect(rename).not.toHaveBeenCalled();
    expect(title.textContent).toBe("カモメ");
    key("Enter"); await settle();
    expect(rename).toHaveBeenCalledOnce();
  });

  it("keeps failed drafts editable for correction and retry", async () => {
    rename.mockRejectedValueOnce(new Error("A note already uses this name."));
    title.click(); title.textContent = "Taken"; key("Enter"); await settle();
    expect(title.textContent).toBe("Taken");
    expect(title.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(header.container.querySelector('[role="status"]')?.textContent).toContain("already uses");
    title.textContent = "Available"; key("Enter"); await settle();
    expect(title.textContent).toBe("Available");
    expect(title.hasAttribute("aria-invalid")).toBe(false);
  });

  it("does not save an unchanged name or a draft abandoned by navigation or disposal", () => {
    title.click(); key("Enter"); expect(rename).not.toHaveBeenCalled();
    title.click(); title.textContent = "Abandoned";
    header.update(Object.assign(new TFile(), { path: "Topics/Other.md" }), { ...properties, "emberly-id": "other" });
    title.blur(); expect(title.textContent).toBe("Other");
    title.click(); title.textContent = "Disposed"; header.dispose(); title.blur();
    expect(rename).not.toHaveBeenCalled();
  });

  it("does not overwrite the next topic when an earlier rename finishes", async () => {
    let finish!: () => void;
    rename.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    title.click(); title.textContent = "Pending"; key("Enter");
    header.update(Object.assign(new TFile(), { path: "Topics/Other.md" }), { ...properties, "emberly-id": "other" });
    finish(); await settle();
    expect(title.textContent).toBe("Other");
    expect(title.getAttribute("aria-disabled")).toBe("false");
  });
});
