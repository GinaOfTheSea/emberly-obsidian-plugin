import type { EmberlyMap, SourceFile } from "../shared/types";
import type { TopicAppearance } from "../topics/topic-appearance";
import { topicState } from "../vault/note-metadata";

interface MapFileState {
  path: string;
  kind: "map" | "topic";
  id: string;
  mapId: string;
  structure: string;
  appearance: Record<keyof TopicAppearance, string>;
}

export interface MapFileChange {
  before?: MapFileState;
  after?: MapFileState;
  appearanceOnly: boolean;
  appearanceFields: (keyof TopicAppearance)[];
}

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const scalar = (value: unknown): unknown => ["string", "number", "boolean"].includes(typeof value) ? value : null;

function state(source: SourceFile): MapFileState | undefined {
  const fm = source.frontmatter;
  const kind = fm.emberly === "map" ? "map" : fm.emberly === "topic" ? "topic" : undefined;
  if (!kind) return undefined;
  const structureKeys = ["emberly", "emberly-id", "emberly-map", "emberly-format",
    "emberly-root-id", "emberly-layout", "emberly-center", "emberly-center-text", "emberly-center-image",
    "emberly-show-notes", "emberly-show-resources",
    "emberly-parent", "emberly-order", "emberly-side", "emberly-collapsed"];
  return {
    path: source.path, kind,
    id: text(fm["emberly-id"]) || `path:${source.path.toLocaleLowerCase()}`,
    mapId: text(fm["emberly-map"]),
    structure: JSON.stringify([source.path, source.basename, structureKeys.map((key) => scalar(fm[key]))]),
    appearance: {
      color: kind === "topic" ? JSON.stringify([scalar(fm["emberly-color"]), scalar(fm.color)]) : "",
      rating: kind === "topic" ? JSON.stringify([scalar(fm["emberly-rating"]), scalar(fm.rating)]) : "",
      state: kind === "topic" ? JSON.stringify(topicState(source)) : "",
    },
  };
}

/** Track data consumed by the map, not autosave bodies or metadata positions. */
export class MapFileChanges {
  private readonly files = new Map<string, MapFileState>();

  reset(sources: SourceFile[]): void {
    this.files.clear();
    for (const source of sources) this.record(source);
  }

  record(source: SourceFile): MapFileChange | undefined {
    const before = this.files.get(source.path);
    const after = state(source);
    if (after) this.files.set(source.path, after);
    else this.files.delete(source.path);
    if (!before && !after) return undefined;
    const appearanceFields = (["color", "rating", "state"] as const).filter((field) => before?.appearance[field] !== after?.appearance[field]);
    if (before?.structure === after?.structure && !appearanceFields.length) return undefined;
    return { before, after, appearanceFields, appearanceOnly: Boolean(before && after && after.kind === "topic" && before.structure === after.structure) };
  }

  remove(path: string): MapFileChange[] {
    const changes: MapFileChange[] = [];
    for (const [key, before] of this.files) {
      if (key !== path && !key.startsWith(`${path}/`)) continue;
      this.files.delete(key);
      changes.push({ before, appearanceOnly: false, appearanceFields: [] });
    }
    return changes;
  }
}

export function changeAffectsMap(change: MapFileChange, map: EmberlyMap | undefined, mapPath: string): boolean {
  return [change.before, change.after].some((source) => {
    if (!source) return false;
    if (source.kind === "map") return source.path === mapPath || source.id === map?.id;
    if (!map) return false;
    return source.mapId === map.id;
  });
}

/** Filenames and appearance aren't topology. In-place reconciliation preserves the viewport. */
export function sameMapStructure(before: EmberlyMap | undefined, after: EmberlyMap): boolean {
  if (!before || before.id !== after.id || before.layout !== after.layout || before.nodes.length !== after.nodes.length) return false;
  const previous = new Map(before.nodes.map((node) => [node.id, node]));
  return after.nodes.every((node) => {
    const old = previous.get(node.id);
    return old && old.parentId === node.parentId && old.order === node.order
      && old.side === node.side && old.collapsed === node.collapsed;
  });
}
