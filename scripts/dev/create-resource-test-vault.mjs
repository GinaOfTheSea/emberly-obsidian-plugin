import { access, cp, mkdir, copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const project = fileURLToPath(new URL("../../", import.meta.url));
const destination = join(project, ".testvaults", "Resource Ownership v2");
let exists = true;
try { await access(destination); } catch (error) { if (error.code === "ENOENT") exists = false; else throw error; }
if (exists) throw new Error(`Refusing to overwrite an existing vault: ${destination}`);
for (const name of ["main.js", "styles.css", "manifest.json"]) await access(join(project, name));
await cp(join(project, "tests", "fixtures", "resource-v2"), destination, { recursive: true, force: false, errorOnExist: true });
await cp(join(project, "tests", "fixtures", "seagulls", "Emberly Maps"), join(destination, "Emberly Maps"), { recursive: true, force: false, errorOnExist: true });
const plugin = join(destination, ".obsidian", "plugins", "emberly-maps");
await mkdir(plugin, { recursive: true });
for (const name of ["main.js", "styles.css", "manifest.json"]) await copyFile(join(project, name), join(plugin, name));
await writeFile(join(destination, ".obsidian", "community-plugins.json"), JSON.stringify(["emberly-maps"]), { flag: "wx" });
await writeFile(join(destination, ".obsidian", "app.json"), JSON.stringify({ alwaysUpdateLinks: true }), { flag: "wx" });
console.log(`Created fresh test vault: ${destination}`);
