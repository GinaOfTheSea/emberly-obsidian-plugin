import esbuild from "esbuild";
import { builtinModules } from "node:module";
import path from "node:path";

const production = process.argv[2] === "production";
const pluginContext = await esbuild.context({
  entryPoints: ["src/main.ts"],
  alias: {
    "@emberly/dataplane": path.resolve("src/emberly-engine/adapter/dataplane.ts"),
  },
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands", "@codemirror/language", "@codemirror/lint", "@codemirror/search", "@codemirror/state", "@codemirror/view", "@lezer/common", "@lezer/highlight", "@lezer/lr", ...builtinModules],
  format: "cjs",
  target: "es2022",
  loader: { ".woff2": "dataurl", ".svg": "dataurl" },
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  outfile: "main.js",
});
const stylesContext = await esbuild.context({
  entryPoints: ["src/styles/plugin.css"],
  bundle: true,
  loader: { ".woff2": "dataurl" },
  logLevel: "info",
  minify: production,
  outfile: "styles.css",
});

if (production) {
  await Promise.all([pluginContext.rebuild(), stylesContext.rebuild()]);
  await Promise.all([pluginContext.dispose(), stylesContext.dispose()]);
} else {
  await Promise.all([pluginContext.watch(), stylesContext.watch()]);
}
