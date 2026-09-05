import { describe, expect, it } from "vitest";
import { build } from "esbuild";
// @ts-expect-error Build scripts deliberately use plain JavaScript.
import { adaptPixiImages, pixiLocalImages } from "../../scripts/build/pixi-local-images.mjs";

describe("Pixi local image bundle", () => {
  it.each(["esm", "cjs"])("removes network calls from the installed %s modules", async (format) => {
    const contents = format === "esm"
      ? 'export { settings } from "@pixi/settings"; export { ImageResource } from "@pixi/core";'
      : 'exports.settings = require("@pixi/settings").settings; exports.ImageResource = require("@pixi/core").ImageResource;';
    const options = { stdin: { contents, resolveDir: process.cwd() }, bundle: true, write: false, minify: true };
    const original = (await build(options)).outputFiles![0]!.text;
    expect(original.match(/\bfetch\s*\(/g)).toHaveLength(2);
    const adapted = (await build({ ...options, plugins: [pixiLocalImages()] })).outputFiles![0]!.text;
    expect(adapted).not.toMatch(/\bfetch\s*\(|XMLHttpRequest/);
    expect(original.match(/\bnew\s+Function\s*\(/g)).toHaveLength(3);
    expect(adapted).not.toMatch(/\bnew\s+Function\s*\(|\beval\s*\(/);
    expect(adapted).toContain("Pixi network loading is disabled");
  });

  it("refuses changed upstream code instead of silently retaining network access", () => {
    expect(() => adaptPixiImages("unexpected upstream source", "core")).toThrow("review");
    expect(() => adaptPixiImages("fetch: function (url, options) { return fetch(url, options); }\nfetch('extra');", "settings"))
      .toThrow("Unexpected fetch call");
  });
});
