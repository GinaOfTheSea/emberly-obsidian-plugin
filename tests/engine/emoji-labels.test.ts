import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The renderer is JavaScript.
import DynamicText from "../../src/emberly-engine/tree/text/DynamicText.js";

vi.mock("../../src/emberly-engine/tree/pixi", () => ({
  Container: class {}, Sprite: class {}, Point: class {}, Rectangle: class {},
  BaseTexture: class {}, CanvasResource: class {}, Texture: class {},
}));

function characters(text: string) {
  const label = { _inputText: text, _style: {}, chars: [] as { value: string; emoji: boolean }[], charCount: 0,
    atlas: { getCharObject: () => ({ emoji: false, paint: false }) } };
  DynamicText.prototype.processInputText.call(label);
  return label.chars.slice(0, label.charCount);
}

describe("emoji sequences in map labels", () => {
  it.each(["🐦", "👨‍👩‍👧‍👦", "👩🏿‍💻", "🇳🇴", "1️⃣", "#️⃣", "❤️", "↔️", "🏳️‍🌈", "👩‍⚕", "🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}"])
    ("keeps %s in one atlas glyph", (emoji) => {
      expect(characters(`A${emoji}B`).map((char) => char.value)).toEqual(["A", emoji, "B"]);
      expect(characters(emoji)[0]?.emoji).toBe(true);
    });

  it("preserves non-emoji text, repeated emoji and astral characters before a match", () => {
    const text = "𝒜鳥🐦🪶 A1#* é";
    expect(characters(text).map((char) => char.value)).toEqual(["𝒜", "鳥", "🐦", "🪶", " ", "A", "1", "#", "*", " ", "é"]);
    expect(characters("🐦🐦").map((char) => char.value)).toEqual(["🐦", "🐦"]);
    expect(characters("123#*").some((char) => char.emoji)).toBe(false);
    expect(characters("")).toEqual([]);
  });
});
