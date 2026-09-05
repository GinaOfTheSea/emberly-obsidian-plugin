// Offline, opt-in tooling only. Never imported by the running plugin.
import { isMap, isScalar, parseDocument } from "yaml";
import { isDeepStrictEqual } from "node:util";
import { indexEmberlyFiles } from "../../src/maps/model";
import { buildResourceCatalog } from "../../src/resources/resource-catalog";
import { leanTopicProperties, noteTitle } from "../../src/vault/note-metadata";
import type { SourceFile } from "../../src/shared/types";

export interface CleanupChange { path: string; before: string; after: string; removed: string[]; }
export interface CleanupPlan { changes: CleanupChange[]; skipped: { path: string; reason: string }[]; }

function header(content: string) {
  const match = /^(\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) throw new Error("No frontmatter");
  const yaml = match[2]!;
  const doc = parseDocument(yaml, { uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents)) throw new Error("Invalid or duplicate YAML properties");
  return { match, yaml, doc, map: doc.contents, properties: doc.toJS() as Record<string, unknown> };
}

/** Cut only selected top-level fields, leaving every retained byte alone. */
export function removeProperties(content: string, keys: string[]): string {
  const { match, yaml, map, properties } = header(content);
  if (map.flow) throw new Error("Flow-style frontmatter needs manual cleanup");
  const ranges: [number, number][] = [];
  for (const pair of map.items) {
    if (!isScalar(pair.key) || !keys.includes(String(pair.key.value))) continue;
    if (!pair.key.range) throw new Error("Cannot locate property");
    const start = yaml.lastIndexOf("\n", pair.key.range[0] - 1) + 1;
    if (yaml.slice(start, pair.key.range[0]).trim()) throw new Error("Property shares a line with other content");
    const value = pair.value as { range?: [number, number, number] } | null;
    let end = value?.range?.[2] ?? pair.key.range[2];
    // null values can have only a key range; include ':' and that line's newline.
    if (end < yaml.length && yaml[end - 1] !== "\n") {
      const newline = yaml.indexOf("\n", end);
      end = newline < 0 ? yaml.length : newline + 1;
    }
    ranges.push([start, end]);
  }
  let result = yaml;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) result = result.slice(0, start) + result.slice(end);
  const expected = { ...properties };
  for (const key of keys) delete expected[key];
  const check = parseDocument(result, { uniqueKeys: true });
  if (check.errors.length || !isDeepStrictEqual(check.toJS(), expected)) throw new Error("Cleanup would change retained properties (possibly shared YAML anchors)");
  const prefix = match[0].slice(0, match[0].indexOf("\n") + 1);
  return prefix + result + content.slice(prefix.length + yaml.length);
}

export function planLeanCleanup(documents: { path: string; content: string }[]): CleanupPlan {
  const result: CleanupPlan = { changes: [], skipped: [] };
  const parsed: SourceFile[] = [];
  for (const file of documents) {
    if (file.path.split("/").some((part) => part.startsWith("."))) continue;
    try {
      const { properties } = header(file.content);
      parsed.push({ ...file, basename: noteTitle(file.path), frontmatter: properties });
    } catch (error) {
      if (/^emberly(?:-format)?:/m.test(file.content)) result.skipped.push({ path: file.path, reason: String(error) });
    }
  }
  const mapFolders = parsed.filter((file) => file.frontmatter.emberly === "map" && !file.path.split("/").includes("Assets"))
    .map((file) => file.path.slice(0, file.path.lastIndexOf("/") + 1));
  const files = parsed.filter((file) => !mapFolders.some((folder) => file.path.startsWith(`${folder}Assets/`)));
  const maps = indexEmberlyFiles(files), catalog = buildResourceCatalog(files, maps);
  const counts = new Map<string, number>();
  for (const file of files) {
    const ids = [file.frontmatter["emberly-id"], file.frontmatter.emberly === "map" ? file.frontmatter["emberly-root-id"] : undefined];
    for (const id of ids) if (typeof id === "string") counts.set(id.toLowerCase(), (counts.get(id.toLowerCase()) ?? 0) + 1);
  }
  const unique = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9-]+$/i.test(id) && counts.get(id.toLowerCase()) === 1;
  const validMaps = maps.filter((map) => map.format === 2 && !map.issues.length && unique(map.id) && map.nodes.every((node) => unique(node.id)));
  for (const file of files) {
    const fm = file.frontmatter, kind = fm.emberly;
    if (!["map", "topic", "resource"].includes(String(kind))) continue;
    try {
      if (!unique(fm["emberly-id"])) throw new Error("Missing, invalid or duplicated ID");
      if (fm["emberly-format"] !== 2) throw new Error("Unsupported or missing format");
      const map = kind === "map" ? validMaps.find((map) => map.path === file.path) : validMaps.find((map) => map.id === fm["emberly-map"]);
      if (!map) throw new Error("Map is missing, ambiguous or has hierarchy issues");
      const node = kind === "topic" ? map.nodes.find((node) => node.path === file.path && node.id === fm["emberly-id"]) : undefined;
      if (kind === "topic" && !node) throw new Error("Topic is not in its map hierarchy");
      if (kind === "resource" && !catalog.resources.some((resource) => resource.path === file.path)) throw new Error("Resource ownership is invalid");
      if (kind === "topic") {
        for (const [key, min, max] of [["emberly-color", -1, 0xffffff], ["emberly-rating", 0, 5], ["emberly-state", 0, 0x7fffffff]] as const) {
          if (key in fm && (typeof fm[key] !== "number" || !Number.isInteger(fm[key]) || fm[key] < min || fm[key] > max)) throw new Error(`Invalid ${key}`);
        }
        if ("emberly-side" in fm && !["left", "right", "center"].includes(String(fm["emberly-side"]))) throw new Error("Invalid side");
        if ("emberly-collapsed" in fm && typeof fm["emberly-collapsed"] !== "boolean") throw new Error("Invalid collapse setting");
      }
      const after = leanTopicProperties(fm, Boolean(node && !node.parentId));
      delete after.title;
      const removed = Object.keys(fm).filter((key) => !(key in after));
      if (removed.length) result.changes.push({ path: file.path, before: file.content!, after: removeProperties(file.content!, removed), removed });
    } catch (error) { result.skipped.push({ path: file.path, reason: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}
