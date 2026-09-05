import { TFolder, parseYaml, stringifyYaml, type App, type TFile } from "obsidian";
import { hasWindowsReservedCharacter } from "../shared/text-validation";

/** Shared file preparation. Existing frontmatter edits use FrontmatterEditor. */
export function frontmatter(content: string): { properties: Record<string, unknown>; body: string; newline: string; bom: string } {
  const match = /^(\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) throw new Error("The note is missing its Emberly properties.");
  const properties: unknown = parseYaml(match[2]!);
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new Error("The note's properties are invalid.");
  return { properties: properties as Record<string, unknown>, body: content.slice(match[0].length), newline: content.includes("\r\n") ? "\r\n" : "\n", bom: match[1] ?? "" };
}

/** New copies and compare-and-write transfer documents retain body bytes and newlines. */
export function serializeNote(doc: ReturnType<typeof frontmatter>): string {
  return `${doc.bom}---${doc.newline}${stringifyYaml(doc.properties).trimEnd().replace(/\r?\n/g, doc.newline)}${doc.newline}---${doc.newline}${doc.body}`;
}

export function relativeLink(from: string, to: string): string {
  const parent = from.split("/").slice(0, -1), target = to.split("/");
  while (parent.length && parent[0] === target[0]) { parent.shift(); target.shift(); }
  return [...parent.map(() => ".."), ...target].join("/");
}

export function safeName(name: string): string {
  const stem = [...name].map((character) => hasWindowsReservedCharacter(character) ? "-" : character).join("").replace(/^[. ]+|[. ]+$/g, "");
  const short = Array.from(stem || "Resource").slice(0, 120).join("").replace(/[. ]+$/g, "");
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(short) ? `_${short}` : short;
}

/** Keep ordinary extensions and bytes, including extensionless and empty files. */
export function fileNameParts(name: string): { stem: string; extension: string } {
  const leaf = name.split(/[\\/]/).at(-1) || "Resource";
  const dot = leaf.lastIndexOf(".");
  if (dot <= 0 || dot === leaf.length - 1) return { stem: safeName(leaf), extension: "" };
  return { stem: safeName(leaf.slice(0, dot)), extension: safeName(leaf.slice(dot + 1)) };
}

export async function ensureFolder(app: App, path: string): Promise<void> {
  let current = "";
  for (const segment of path.split("/")) {
    current = current ? `${current}/${segment}` : segment;
    if (!app.vault.getAbstractFileByPath(current)) {
      try { await app.vault.createFolder(current); }
      catch (error) { if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error; }
    }
    if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw new Error(`A file is blocking folder “${current}”.`);
  }
}

/** Vault.create* refuses overwrites; retry collisions introduced during awaits. */
export async function createUnique(app: App, folder: string, stem: string, extension: string, create: (path: string) => Promise<TFile>): Promise<TFile> {
  for (let suffix = 1; suffix <= 1000; suffix++) {
    const path = `${folder}/${stem}${suffix === 1 ? "" : ` (${suffix})`}${extension ? `.${extension}` : ""}`;
    if (app.vault.getAbstractFileByPath(path)) continue;
    try { return await create(path); }
    catch (error) { if (!app.vault.getAbstractFileByPath(path)) throw error; }
  }
  throw new Error("Too many files share this name. Choose another resource name and try again.");
}
