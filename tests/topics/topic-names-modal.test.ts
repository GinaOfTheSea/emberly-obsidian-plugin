// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TopicNamesModal } from "../../src/ui/modals";
import { installObsidianDom } from "../helpers/obsidian-dom";

vi.mock("obsidian", async (original) => ({ ...await original<object>(),
  Modal: class {
    contentEl = document.createElement("div");
    constructor(_app: App) {}
    setTitle(_title: string) {}
    open() { document.body.append(this.contentEl); (this as any).onOpen(); }
    close() { (this as any).onClose(); this.contentEl.remove(); }
  },
  SuggestModal: class {},
}));

describe("batch topic input (isolated DOM)", () => {
  let modal: TopicNamesModal, submit: ReturnType<typeof vi.fn<(name: string) => Promise<void>>>;
  const input = () => modal.contentEl.querySelector("input")!;
  const chips = () => Array.from(modal.contentEl.querySelectorAll('[role="listitem"] > span'), (item) => item.textContent);
  const key = (options: KeyboardEventInit = {}) => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options }));
  const type = (value: string) => { input().value = value; input().dispatchEvent(new Event("input")); };
  const paste = (value: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => value } });
    input().dispatchEvent(event); return event;
  };
  beforeEach(() => {
    installObsidianDom(); submit = vi.fn(async () => {});
    modal = new TopicNamesModal({} as App, "Add topics", submit); modal.open();
  });
  afterEach(() => { modal.close(); document.body.replaceChildren(); });

  it("Enter queues a removable name without saving or closing", () => {
    type("  First topic  "); key();
    expect(chips()).toEqual(["First topic"]); expect(input().value).toBe("");
    expect(submit).not.toHaveBeenCalled(); expect(modal.contentEl.isConnected).toBe(true);
    modal.contentEl.querySelector<HTMLButtonElement>('[aria-label="Remove First topic"]')!.click();
    expect(chips()).toEqual([]); expect(document.activeElement).toBe(input());
    key(); expect(chips()).toEqual([]);
  });
  it("pastes comma/newline lists as chips, keeping duplicates and ignoring empty items", () => {
    expect(paste("One, Two, , One,\nThree\r\n").defaultPrevented).toBe(true);
    expect(chips()).toEqual(["One", "Two", "One", "Three"]);
    expect(submit).not.toHaveBeenCalled();
  });
  it("uses the current cursor selection when pasting a list", () => {
    type("Old tail"); input().setSelectionRange(0, 3);
    paste("First, Second"); expect(chips()).toEqual(["First", "Second tail"]);
    expect(paste("Plain name").defaultPrevented).toBe(false);
  });
  it("queues the last names with Enter and creates them with another Enter", async () => {
    type("First"); key(); type("Second, Third"); key();
    expect(submit).not.toHaveBeenCalled();
    key();
    await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
    expect(submit.mock.calls).toEqual([["First"], ["Second"], ["Third"]]);
  });
  it("Create includes a pending name; Enter with no names keeps the dialog open", async () => {
    type("Draft"); modal.contentEl.querySelector<HTMLButtonElement>(".mod-cta")!.click();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith("Draft"));
    await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
    modal = new TopicNamesModal({} as App, "Empty", submit); modal.open(); key(); key();
    expect(modal.contentEl.isConnected).toBe(true); expect(submit).toHaveBeenCalledTimes(1);
  });
  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])("ignores modified Enter %j", (modifier) => {
    type("Draft"); key(modifier);
    expect(chips()).toEqual([]); expect(input().value).toBe("Draft");
    key(); key(modifier);
    expect(submit).not.toHaveBeenCalled(); expect(modal.contentEl.isConnected).toBe(true);
  });
  it("ignores IME composition and repeated Enter", () => {
    type("日本語"); key({ isComposing: true }); key({ repeat: true });
    expect(chips()).toEqual([]); expect(submit).not.toHaveBeenCalled();
    key(); expect(chips()).toEqual(["日本語"]);
    key({ repeat: true }); key({ isComposing: true });
    expect(submit).not.toHaveBeenCalled();
  });
  it("disables editing while saving and prevents repeated submission", async () => {
    let finish!: () => void;
    submit.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    paste("First, Second"); key(); key();
    expect(input().disabled).toBe(true); expect(submit).toHaveBeenCalledTimes(1);
    expect(modal.contentEl.querySelector<HTMLButtonElement>(".mod-cta")!.disabled).toBe(true);
    finish(); await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
    expect(submit.mock.calls).toEqual([["First"], ["Second"]]);
  });
  it("keeps failed and unstarted chips for retry, never resubmitting successful ones", async () => {
    submit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Disk full"));
    paste("First, Second, Third"); key();
    await vi.waitFor(() => expect(modal.contentEl.querySelector('[role="alert"]')!.textContent).toContain("Disk full"));
    expect(chips()).toEqual(["Second", "Third"]); expect(input().disabled).toBe(false);
    key(); await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
    expect(submit.mock.calls).toEqual([["First"], ["Second"], ["Second"], ["Third"]]);
  });
  it("closing discards pending names and stops unstarted saves", async () => {
    type("Not saved"); key(); modal.close(); expect(submit).not.toHaveBeenCalled();
    modal = new TopicNamesModal({} as App, "Batch", submit); modal.open();
    let finish!: () => void;
    submit.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    paste("First, Second"); key(); modal.close(); finish();
    await Promise.resolve(); await Promise.resolve();
    expect(submit.mock.calls).toEqual([["First"]]);
  });
});
