import type { EmberlyMap } from "../shared/types";

/** No folder-based ownership: an unrelated note must stay an ordinary note. */
export function belongsToIntegratedMap(map: EmberlyMap, path: string, properties: Record<string, unknown>): boolean {
  if (map.path === path || map.nodes.some((node) => node.path === path)) return true;
  return properties.emberly === "resource" && properties["emberly-map"] === map.id;
}

export function inspectorWidth(requested: number, available: number): number {
  const maximum = Math.max(240, Math.min(720, available - 286));
  return Math.round(Math.max(240, Math.min(maximum, Number.isFinite(requested) ? requested : 380)));
}
