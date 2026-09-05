import { generateKeyBetween } from "./fractions";
import type { EmberlyMap, EmberlyNode } from "../shared/types";

/** Case-sensitive code-point ordering, never locale collation (Z sorts before a). */
export function compareOrder(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isOrderKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z][0-9A-Za-z]+$/.test(value)) return false;
  try { generateKeyBetween(value, null); return true; } catch { return false; }
}

export function topicOrderBetween(previous?: EmberlyNode, next?: EmberlyNode): string {
  if (previous && !isOrderKey(previous.order) || next && !isOrderKey(next.order)) throw new Error("Invalid topic ordering key.");
  return generateKeyBetween(previous ? previous.order as string : null, next ? next.order as string : null);
}

export function appendTopicOrder(map: EmberlyMap, parentId: string): string {
  const siblings = map.nodes.filter((node) => node.parentId === parentId).sort((a, b) => compareOrder(a.order, b.order) || compareOrder(a.id, b.id));
  return topicOrderBetween(siblings.at(-1));
}

export interface TopicMove {
  id: string; parentId: string | null; previousParentId?: string | null;
  previousSiblingId?: string | null; nextSiblingId?: string | null;
  index?: number | string;
}

/** Check an optimistic drag against the latest tree before writing one topic. */
export function topicMoveProperties(map: EmberlyMap, move: TopicMove): Record<string, unknown> {
  if (map.format !== 2 || map.issues.length) throw new Error("Repair the map hierarchy before moving topics.");
  const source = map.nodes.find((node) => node.id === move.id);
  if (!source?.parentId || !move.parentId) throw new Error("The root topic cannot be moved.");
  if (move.previousParentId !== undefined && source.parentId !== move.previousParentId) throw new Error("The topic's parent changed. Select it again.");
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  let ancestor = byId.get(move.parentId);
  if (!ancestor) throw new Error("The destination parent is missing from this map.");
  const seen = new Set([source.id]);
  while (ancestor) {
    if (seen.has(ancestor.id)) throw new Error("A topic cannot be moved into its own branch.");
    seen.add(ancestor.id);
    ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
  }
  const siblings = map.nodes.filter((node) => node.parentId === move.parentId && node.id !== move.id)
    .sort((a, b) => compareOrder(a.order, b.order) || compareOrder(a.id, b.id));
  const previous = move.previousSiblingId ? siblings.find((node) => node.id === move.previousSiblingId) : undefined;
  const next = move.nextSiblingId ? siblings.find((node) => node.id === move.nextSiblingId) : undefined;
  if (move.previousSiblingId && !previous || move.nextSiblingId && !next
    || (previous ? siblings.indexOf(previous) + 1 : 0) !== (next ? siblings.indexOf(next) : siblings.length)) {
    throw new Error("Sibling order changed. Try the move again.");
  }
  let key: string;
  if (move.index !== undefined) {
    // Retain the renderer's exact key, including ties between opposite root sides.
    // Regenerating a different midpoint would make subsequent queued drags stale.
    if (!isOrderKey(move.index)) throw new Error("The new topic ordering key is invalid.");
    key = move.index;
    const compare = (node: EmberlyNode) => compareOrder(node.order, key) || compareOrder(node.id, move.id);
    if (previous && compare(previous) >= 0 || next && compare(next) <= 0) throw new Error("The new ordering key no longer fits between its siblings.");
  } else key = topicOrderBetween(previous, next);
  return { "emberly-parent": move.parentId, "emberly-order": key };
}
