import { readFile } from "node:fs/promises";
import path from "node:path";

// Pixi 6.5.1 includes two fetch paths even when its optional bitmap mode is off.
// Keep this adaptation in the build (including browser tests), rather than
// editing node_modules or leaving network-capable code disabled at runtime.
const adapterFetch = "fetch: function (url, options) { return fetch(url, options); }";
const bitmapFetch = `var cors = !source.crossOrigin || source.crossOrigin === 'anonymous';
        this._process = fetch(source.src, {
            mode: cors ? 'cors' : 'no-cors'
        })
            .then(function (r) { return r.blob(); })
            .then(function (blob) { return createImageBitmap(blob,`;

export function adaptPixiImages(source, moduleName) {
  const before = moduleName === "settings" ? adapterFetch : bitmapFetch;
  const after = moduleName === "settings"
    ? 'fetch: function () { return Promise.reject(new Error("Emberly Maps: Pixi network loading is disabled. Use bundled or vault images.")); }'
    // HTMLImageElement is an ImageBitmapSource. Preserve Pixi's crop, alpha,
    // bitmap caching and disposal while avoiding a second load of source.src.
    : `this._process = Promise.resolve()
            .then(function () { return createImageBitmap(source,`;
  const normalized = source.replace(/\r\n/g, "\n");
  if (normalized.split(before).length !== 2) {
    throw new Error(`Pixi ${moduleName} changed: review the local-image build adaptation before upgrading.`);
  }
  const contents = normalized.replace(before, after);
  if (/\bfetch\s*\(/.test(contents)) {
    throw new Error(`Unexpected fetch call in Pixi ${moduleName}: review image loading before building.`);
  }
  return contents;
}

export function pixiLocalImages() {
  return {
    name: "pixi-local-images",
    setup(build) {
      build.onLoad({ filter: /[\\/]@pixi[\\/](core|settings)[\\/]dist[\\/](esm|cjs)[\\/](core|settings)\.m?js$/ }, async ({ path: file }) => {
        const moduleName = path.basename(file).split(".")[0];
        const manifest = JSON.parse(await readFile(path.resolve(path.dirname(file), "../../package.json"), "utf8"));
        if (manifest.version !== "6.5.1") {
          throw new Error(`Review the Pixi local-image adaptation for ${manifest.name}@${manifest.version}.`);
        }
        return { contents: adaptPixiImages(await readFile(file, "utf8"), moduleName), loader: "js" };
      });
    },
  };
}
