import type { SourceFile } from "../shared/types";
import { hasWindowsReservedCharacter } from "../shared/text-validation";

/** The notes marker reflects the native Markdown body without persisting a flag. */
export function topicState(source: SourceFile): number {
  const stored = source.frontmatter["emberly-state"] ?? source.frontmatter.state;
  const state = typeof stored === "number" && Number.isFinite(stored) ? stored : 0;
  const hasNotes = source.content !== undefined
    ? Boolean(source.content.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim()) : source.hasNotes;
  return hasNotes === undefined ? state : (state & ~8) | (hasNotes ? 8 : 0);
}

/** A note's filename is its only display name. Attachment extensions are retained. */
export function noteTitle(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

/** Map notes use a recognizable compound Markdown suffix in the file explorer. */
export function mapTitle(path: string): string {
  return noteTitle(path).replace(/\.emberly$/i, "");
}

export function mapNoteFilename(name: string): string {
  return `${name}.emberly.md`;
}

export function isMapNotePath(path: string): boolean {
  return /\.emberly\.md$/i.test(path);
}

/** Remove only known, redundant topic settings. Never touch historical dates or custom fields. */
export function leanTopicProperties<T extends Record<string, unknown>>(properties: T, root = false): T {
  const result = { ...properties };
  if (result.emberly !== "topic") return result;
  const defaults: Record<string, unknown> = {
    "emberly-side": "right", "emberly-color": -1, "emberly-collapsed": false,
    "emberly-rating": 0, "emberly-state": 0,
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (result[key] === value) delete result[key];
  }
  if (root) delete result["emberly-side"];
  return result;
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Reservations are synchronous and last for this index's lifetime, including failed writes. */
export class NoteIdAllocator {
  private readonly reserved = new Set<string>();
  constructor(
    private readonly existing: () => Iterable<string>,
    private readonly random: (bytes: Uint8Array) => void = (bytes) => { crypto.getRandomValues(bytes); },
  ) {}
  allocate(): string {
    const used = new Set(Array.from(this.existing(), (id) => id.toLowerCase()));
    for (let attempt = 0; attempt < 1000; attempt++) {
      const bytes = new Uint8Array(16);
      this.random(bytes);
      // 256 divides evenly by 32: no modulo bias (80 bits of entropy).
      const id = Array.from(bytes, (byte) => ALPHABET[byte & 31]).join("");
      if (used.has(id) || this.reserved.has(id)) continue;
      this.reserved.add(id);
      return id;
    }
    throw new Error("Could not allocate a unique Emberly ID. No existing IDs were changed.");
  }
}

function validatedName(name: string): string {
  if (!name || name !== name.trim() || hasWindowsReservedCharacter(name)
    || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error("Enter a valid note filename without path separators or reserved characters.");
  }
  return name;
}

/** Renames reject unsafe names instead of silently choosing a different title. */
export function renamedNotePath(path: string, name: string): string {
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  return `${folder}${validatedName(name)}.md`;
}

export function renamedMapPath(path: string, name: string): string {
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  return `${folder}${mapNoteFilename(validatedName(name))}`;
}
