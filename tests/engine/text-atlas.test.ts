// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Preserved renderer is JavaScript.
import DynamicAtlas from "../../src/emberly-engine/tree/text/DynamicAtlas.js";
// @ts-expect-error Preserved renderer is JavaScript.
import DynamicTextStyle from "../../src/emberly-engine/tree/text/DynamicTextStyle.js";
// @ts-expect-error Preserved renderer is JavaScript.
import TextMetrics from "../../src/emberly-engine/tree/text/TextMetrics.js";

// Exercise the real atlas packing and font metrics, substituting only GPU/DOM
// drawing. run-engine-text.cjs additionally checks actual rendered pixels.
vi.mock("../../src/emberly-engine/tree/pixi", async () => {
  const { Rectangle, Point } = await import("@pixi/math");
  return { Rectangle, Point, Container: class {}, Sprite: class {}, CanvasResource: class {},
    BaseTexture: class { update() {} destroy() {} },
    Texture: class { update() {} updateUvs() {} },
  };
});

describe("independent map text atlases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillText: vi.fn() } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each([[48, "normal"], [80, "600"]])("keeps font metrics and other maps intact at %s/%s", (size, weight) => {
    const style = new DynamicTextStyle();
    style.fontSize = size; style.fontWeight = weight;
    const chars = [...new Set("Seagulls Herring Gull")];
    const originalMetrics = structuredClone(TextMetrics);
    const first = new DynamicAtlas(1);
    const firstGlyphs = chars.map((char) => first.getCharObject(char, style));
    first.addNewObjects();
    const packedFrames = firstGlyphs.map((glyph) => glyph.frame?.clone());
    const second = new DynamicAtlas(1);
    // Deliberately pack another map in a different order.
    for (const char of [...chars].reverse()) second.getCharObject(char, style);
    second.addNewObjects();
    expect(structuredClone(TextMetrics)).toEqual(originalMetrics);
    expect(firstGlyphs.map((glyph) => glyph.frame?.clone())).toEqual(packedFrames);
    for (const char of chars) {
      const original = originalMetrics[style.ctxKey(char)];
      expect(second.getCharObject(char, style)).toMatchObject({ rectX: original.rect?.x ?? 0, rectY: original.rect?.y ?? 0 });
    }
    first.destroy(); second.destroy();
  });
});
