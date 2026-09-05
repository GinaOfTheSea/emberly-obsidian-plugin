import esbuild from "esbuild";
import path from "node:path";
import { pixiLocalImages } from "./pixi-local-images.mjs";

await esbuild.build({
  entryPoints: ["tests/browser/engine-smoke-entry.ts"],
  outfile: "tests/browser/engine-smoke.js",
  bundle: true,
  plugins: [pixiLocalImages()],
  platform: "browser",
  target: "chrome120",
  loader: { ".woff2": "dataurl" },
  alias: { "@emberly/dataplane": path.resolve("src/emberly-engine/adapter/dataplane.ts") },
});
