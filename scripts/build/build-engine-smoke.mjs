import esbuild from "esbuild";
import path from "node:path";

await esbuild.build({
  entryPoints: ["tests/browser/engine-smoke-entry.ts"],
  outfile: "tests/browser/engine-smoke.js",
  bundle: true,
  platform: "browser",
  target: "chrome120",
  loader: { ".woff2": "dataurl" },
  alias: { "@emberly/dataplane": path.resolve("src/emberly-engine/adapter/dataplane.ts") },
});
