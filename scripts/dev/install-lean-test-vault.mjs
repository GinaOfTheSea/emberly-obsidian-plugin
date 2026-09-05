// Explicitly scoped rollout: dry run by default, no Obsidian control or settings writes.
import { build } from "esbuild";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const vault = resolve(project, ".testvaults/Resource Ownership v2");
const plugin = ".obsidian/plugins/emberly-maps";
const artifacts = ["main.js", "manifest.json", "styles.css"];
const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some((arg) => arg !== "--apply")) throw new Error("Only --apply is supported; the vault target is fixed.");
if (await realpath(vault) !== vault) throw new Error("Refusing a redirected vault path");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function allFiles(directory = vault) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Symlink requires manual review: ${entry.name}`);
    const path = resolve(directory, entry.name);
    if (!path.startsWith(vault + sep)) throw new Error("Path escaped test vault");
    if (entry.isDirectory()) result.push(...await allFiles(path));
    else if (entry.isFile()) result.push(relative(vault, path).split(sep).join("/"));
  }
  return result.sort();
}
const bundled = await build({ entryPoints: [resolve(project, "scripts/dev/lean-cleanup.ts")], bundle: true, platform: "node", format: "cjs", write: false });
const compiled = { exports: {} };
new Function("module", "exports", "require", bundled.outputFiles[0].text + "\n//# sourceURL=emberly-lean-cleanup.cjs")(compiled, compiled.exports, createRequire(import.meta.url));
const { planLeanCleanup } = compiled.exports;
const paths = await allFiles();
const documents = await Promise.all(paths.filter((path) => path.endsWith(".md") && !path.split("/").some((part) => part.startsWith(".")))
  .map(async (path) => ({ path, content: await readFile(resolve(vault, path), "utf8") })));
const plan = planLeanCleanup(documents);
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", vault, changes: plan.changes.map(({ path, removed }) => ({ path, removed })), skipped: plan.skipped }, null, 2));
if (!apply) process.exit(0);

const hashes = new Map(await Promise.all(paths.map(async (path) => [path, hash(await readFile(resolve(vault, path)))])));
const backup = resolve(project, ".testvaults/.plugin-backups", `before-lean-properties-${randomUUID()}`);
await mkdir(backup, { recursive: false });
const replacements = new Map(plan.changes.map((change) => [change.path, Buffer.from(change.after)]));
for (const name of artifacts) replacements.set(`${plugin}/${name}`, await readFile(resolve(project, name)));
// Complete and verify ALL backups before the first vault write.
for (const path of replacements.keys()) {
  const destination = resolve(backup, "files", path);
  if (!destination.startsWith(backup + sep)) throw new Error("Unsafe backup path");
  await mkdir(dirname(destination), { recursive: true });
  const original = await readFile(resolve(vault, path));
  if (hash(original) !== hashes.get(path)) throw new Error(`File changed before backup: ${path}`);
  await writeFile(destination, original, { flag: "wx" });
  if (hash(await readFile(destination)) !== hashes.get(path)) throw new Error(`Backup verification failed: ${path}`);
}
const manifest = { vault, hashes: Object.fromEntries(hashes), changed: [...replacements.keys()], skipped: plan.skipped };
await writeFile(resolve(backup, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(`Verified rollback backup: ${backup}`);
for (const [path, next] of replacements) {
  const target = resolve(vault, path);
  if (!target.startsWith(vault + sep) || hash(await readFile(target)) !== hashes.get(path)) throw new Error(`File changed during rollout: ${path}. Backup kept at ${backup}`);
  await writeFile(target, next);
}
const afterPaths = await allFiles();
if (JSON.stringify(paths) !== JSON.stringify(afterPaths)) throw new Error("Vault file inventory changed during rollout; inspect the backup manifest");
for (const path of paths) {
  const expected = replacements.has(path) ? hash(replacements.get(path)) : hashes.get(path);
  if (hash(await readFile(resolve(vault, path))) !== expected) throw new Error(`Post-install verification failed: ${path}. Backup: ${backup}`);
}
console.log(JSON.stringify({ backup, cleanedNotes: plan.changes.length, installedArtifacts: artifacts.length,
  otherFilesVerifiedUnchanged: paths.length - replacements.size, skipped: plan.skipped }, null, 2));
