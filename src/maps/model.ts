import type { EmberlyLayout, EmberlyMap, EmberlyNode, EmberlySide, SourceFile } from "../shared/types";
import { compareOrder, isOrderKey } from "../topics/topic-hierarchy";
import { mapTitle, noteTitle, topicState } from "../vault/note-metadata";
import { readMapCenter } from "./map-center";

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const number = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown): boolean => value === true;
const dirname = (path: string): string => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const normalize = (path: string): string => path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

function side(value: unknown): EmberlySide {
  return value === "left" || value === "right" || value === "center" ? value : "right";
}

function stableId(file: SourceFile): string {
  return text(file.frontmatter["emberly-id"]) || `path:${normalize(file.path).toLocaleLowerCase()}`;
}

function validate(nodes: EmberlyNode[]): string[] {
  const issues: string[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = nodes.filter((node) => !node.parentId);
  if (roots.length === 0) issues.push("This map has no root topic.");
  if (roots.length > 1) issues.push(`This map has ${roots.length} root topics.`);
  for (const node of nodes) {
    if (node.parentId && !byId.has(node.parentId)) issues.push(`“${node.title}” refers to a missing parent.`);
    const visited = new Set<string>([node.id]);
    let current = node;
    while (current.parentId) {
      if (visited.has(current.parentId)) {
        issues.push(`A parent cycle includes “${node.title}”.`);
        break;
      }
      visited.add(current.parentId);
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
  }
  return [...new Set(issues)];
}

export function indexEmberlyFiles(files: SourceFile[]): EmberlyMap[] {
  const mapFiles = files.filter((file) => file.frontmatter.emberly === "map");
  const topicFiles = files.filter((file) => file.frontmatter.emberly === "topic");
  const mapIdCounts = new Map<string, number>();
  for (const file of mapFiles) mapIdCounts.set(stableId(file), (mapIdCounts.get(stableId(file)) ?? 0) + 1);

  return mapFiles.map((mapFile) => {
    const id = stableId(mapFile);
    const mapTopics = topicFiles.filter((file) => text(file.frontmatter["emberly-map"]) === id);
    const map = indexParentMap(mapFile, mapTopics);
    if ((mapIdCounts.get(id) ?? 0) > 1) map.issues.push(`Duplicate map ID “${id}”; keep only one map note with this ID.`);
    return map;
  }).sort((a, b) => a.title.localeCompare(b.title));
}

function indexParentMap(mapFile: SourceFile, topics: SourceFile[]): EmberlyMap {
  const id = stableId(mapFile);
  const format = Number(mapFile.frontmatter["emberly-format"]);
  const layout: EmberlyLayout = mapFile.frontmatter["emberly-layout"] === "center" ? "center" : "branch";
  const base: EmberlyMap = {
    id, format, path: normalize(mapFile.path), folder: dirname(mapFile.path),
    title: mapTitle(mapFile.path), layout, center: readMapCenter(mapFile.frontmatter), showIcons: readMapIcons(mapFile), nodes: [], issues: [],
  };
  if (format !== 2) return { ...base, issues: [`Unsupported Emberly format “${String(mapFile.frontmatter["emberly-format"])}”. Re-export this map using the current Emberly exporter.`] };
  const issues: string[] = [];
  if (!text(mapFile.frontmatter["emberly-id"])) issues.push("The map note needs a stable emberly-id.");
  const rootId = text(mapFile.frontmatter["emberly-root-id"]);
  if (!rootId) issues.push("The map note needs emberly-root-id.");
  const ids = new Set<string>();
  const nodes = topics.flatMap((file): EmberlyNode[] => {
    const fm = file.frontmatter, topicId = text(fm["emberly-id"]);
    if (!topicId) { issues.push(`“${file.path}” needs a stable emberly-id.`); return []; }
    if (topicId === rootId) {
      issues.push(`“${file.path}” is an unsupported separate root topic; the map document is the root.`);
      return [];
    }
    if (ids.has(topicId)) issues.push(`Duplicate topic ID “${topicId}”; copies must have distinct IDs.`);
    ids.add(topicId);
    if (fm.emberly !== "topic" || fm["emberly-format"] !== 2) issues.push(`“${file.path}” has an unsupported topic format.`);
    const parentId = text(fm["emberly-parent"]) || null;
    if (!parentId) issues.push(`“${file.path}” needs emberly-parent.`);
    const order = fm["emberly-order"];
    if (!isOrderKey(order)) issues.push(`“${file.path}” needs a valid fractional emberly-order key.`);
    return [{
      id: topicId, path: normalize(file.path), mapId: id, title: noteTitle(file.path), parentId,
      order: isOrderKey(order) ? order : "a0",
      side: side(fm["emberly-side"]),
      color: number(fm["emberly-color"], -1), collapsed: bool(fm["emberly-collapsed"]),
      rating: number(fm["emberly-rating"], 0), state: topicState(file),
    }];
  }).sort((a, b) => compareOrder(a.order, b.order) || compareOrder(a.id, b.id));
  if (rootId) {
    nodes.unshift({
      id: rootId, path: normalize(mapFile.path), mapId: id, title: mapTitle(mapFile.path), parentId: null,
      order: "a0", side: layout === "center" ? "center" : "right", color: -1, collapsed: false,
      rating: 0, state: topicState(mapFile),
    });
  }
  return { ...base, nodes, issues: [...new Set([...issues, ...validate(nodes)])] };
}

export function childrenOf(map: EmberlyMap, parentId: string | null): EmberlyNode[] {
  return map.nodes.filter((node) => node.parentId === parentId).sort((a, b) => compareOrder(a.order, b.order) || compareOrder(a.id, b.id));
}

function readMapIcons(file: SourceFile): { notes: boolean; resources: boolean } {
  return { notes: file.frontmatter["emberly-show-notes"] !== false, resources: file.frontmatter["emberly-show-resources"] !== false };
}
