import { readResourceSettings } from "./resource-properties";
import { noteTitle } from "../vault/note-metadata";
import type { EmberlyMap, SourceFile } from "../shared/types";
import type { TopicResource } from "./resource-list";

export interface OwnedResource extends TopicResource { mapId: string; topicId: string; order: number; }
export interface ResourceIssue { path: string; mapId: string; message: string; }
export interface ResourceCatalog { resources: OwnedResource[]; issues: ResourceIssue[]; }
const text = (value: unknown): string => typeof value === "string" ? value : "";

/** Resource format 2 has one owner. Folder names and topic prose never assign it. */
export function buildResourceCatalog(files: SourceFile[], maps: EmberlyMap[]): ResourceCatalog {
  const resources: OwnedResource[] = [], issues: ResourceIssue[] = [];
  const candidates = files.filter((file) => file.frontmatter.emberly === "resource");
  const counts = new Map<string, number>();
  for (const file of candidates) {
    const id = text(file.frontmatter["emberly-id"]);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const file of candidates) {
    const fm = file.frontmatter, mapId = text(fm["emberly-map"]), topicId = text(fm["emberly-topic"]);
    const id = text(fm["emberly-id"]), order = fm["emberly-order"];
    const fail = (message: string): void => { issues.push({ path: file.path, mapId, message: `${file.path}: ${message}` }); };
    if (fm["emberly-format"] !== 2) { fail("Resource format 2 is required. Re-export this map; existing files have not been converted."); continue; }
    if (!id || !topicId || !mapId || fm["emberly-id"] !== id || fm["emberly-topic"] !== topicId
      || ![id, topicId, mapId].every((value) => /^[a-z0-9-]+$/.test(value))) {
      fail("Missing or invalid resource/owner IDs (use lowercase letters, digits and hyphens)."); continue;
    }
    if (counts.get(id) !== 1) { fail(`Duplicate resource ID “${id}”.`); continue; }
    if (typeof order !== "number" || !Number.isSafeInteger(order) || order < 0) { fail("emberly-order must be a non-negative safe integer."); continue; }
    const owners = maps.filter((map) => map.id === mapId);
    if (owners.length !== 1 || owners[0]!.format !== 2 || owners[0]!.issues.length) { fail("The owning map is missing, duplicated or has hierarchy issues."); continue; }
    const topics = owners[0]!.nodes.filter((node) => node.id === topicId);
    if (topics.length !== 1) { fail("The owning topic is not in the map hierarchy."); continue; }
    if (!topics[0]!.parentId) { fail("The map root cannot own resources. Assign this resource to a non-root topic."); continue; }
    resources.push({ id, mapId, topicId, order, path: file.path, title: noteTitle(file.path),
      kind: text(fm["emberly-kind"]) || "note", url: text(fm.url), asset: text(fm["emberly-asset"]),
      ...readResourceSettings(fm) });
  }
  resources.sort((a, b) => b.order - a.order || a.id.localeCompare(b.id));
  return { resources, issues };
}

export function nextResourceOrder(resources: OwnedResource[], mapId: string, topicId: string): number {
  const highest = resources.reduce((max, resource) => resource.mapId === mapId && resource.topicId === topicId ? Math.max(max, resource.order) : max, 0);
  if (highest >= Number.MAX_SAFE_INTEGER) throw new Error("Resource order is exhausted. Renumber this topic's resource orders first.");
  return highest + 1;
}

/** Derived flag only; never write resource counts back into a topic. */
export function withResourceFlags(maps: EmberlyMap[], catalog: ResourceCatalog): EmberlyMap[] {
  const occupied = new Set(catalog.resources.map((resource) => JSON.stringify([resource.mapId, resource.topicId])));
  return maps.map((map) => ({ ...map, nodes: map.nodes.map((node) => ({ ...node,
    state: (node.state & ~4) | (occupied.has(JSON.stringify([map.id, node.id])) ? 4 : 0),
  })) }));
}

export function resourceMembershipSignature(fm: Record<string, unknown>): string {
  return fm.emberly === "resource" ? JSON.stringify([fm.emberly, fm["emberly-format"], fm["emberly-id"], fm["emberly-map"], fm["emberly-topic"], fm["emberly-order"]]) : "";
}
