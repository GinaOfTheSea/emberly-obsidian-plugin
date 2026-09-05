/** Resource metadata lives in its note, independently of topic membership. */
import { hasAsciiControl } from "../shared/text-validation";
export interface ResourceIdentity { id: string; mapId: string; }
export interface ResourceSettings { rating: number; tags: string[]; }
export type ResourceChange = { rating: number } | { addTag: string } | { removeTag: string };

export function resourceIdentity(properties: Record<string, unknown>): ResourceIdentity | undefined {
  const id = properties["emberly-id"], mapId = properties["emberly-map"];
  return properties.emberly === "resource" && properties["emberly-format"] === 2
    && typeof id === "string" && Boolean(id.trim()) && typeof mapId === "string" && Boolean(mapId.trim())
    ? { id, mapId } : undefined;
}

export function resourceTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string")
    : typeof value === "string" ? value.split(/[,\s]+/).filter(Boolean) : [];
}

export function normalizeResourceTag(value: string): string { return value.trim().replace(/^#/, ""); }

export function isResourceTag(value: string): boolean {
  return /^[\p{L}\p{M}\p{N}_/-]+$/u.test(value) && !/^[\p{N}]+$/u.test(value)
    && value.split("/").every((segment) => Boolean(segment));
}

/** Preserve display casing while deduplicating native-style tags. */
export function resourceTagSuggestions(tags: string[], assigned: string[], query: string): string[] {
  const excluded = new Set(assigned.map((tag) => normalizeResourceTag(tag).toLowerCase()));
  const search = normalizeResourceTag(query).toLowerCase();
  const unique = new Map<string, string>();
  for (const value of tags) {
    const tag = normalizeResourceTag(value), key = tag.toLowerCase();
    if (isResourceTag(tag) && !excluded.has(key) && key.includes(search) && !unique.has(key)) unique.set(key, tag);
  }
  return [...unique.values()].sort((a, b) => {
    const prefix = Number(b.toLowerCase().startsWith(search)) - Number(a.toLowerCase().startsWith(search));
    return prefix || a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  });
}

export function readResourceSettings(properties: Record<string, unknown>): ResourceSettings {
  const rating = properties["emberly-rating"] ?? properties.rating;
  return {
    rating: typeof rating === "number" && Number.isInteger(rating) && rating >= 0 && rating <= 5 ? rating : 0,
    tags: resourceTags(properties.tags),
  };
}

export function resourceProperties(properties: Record<string, unknown>, change: ResourceChange): Record<string, unknown> {
  if (Object.keys(change).length !== 1) throw new Error("Change one resource setting at a time.");
  if ("rating" in change) {
    if (!Number.isInteger(change.rating) || change.rating < 0 || change.rating > 5) throw new Error("Rating must be between zero and five.");
    return { "emberly-rating": change.rating };
  }
  // Refuse malformed metadata instead of silently dropping values during edits.
  if (properties.tags != null && typeof properties.tags !== "string"
    && !(Array.isArray(properties.tags) && properties.tags.every((tag) => typeof tag === "string"))) {
    throw new Error("Fix the tags property in Details before editing tags here.");
  }
  const tags = resourceTags(properties.tags);
  if ("removeTag" in change) return { tags: tags.filter((tag) => tag !== change.removeTag) };
  if (!("addTag" in change) || typeof change.addTag !== "string") throw new Error("Invalid resource setting.");
  const tag = normalizeResourceTag(change.addTag);
  // Native-style tags: Unicode letters/numbers, hyphens, underscores and nesting.
  if (!isResourceTag(tag)) {
    throw new Error("Use a tag such as research, café or sailing/weather; no spaces or number-only tags.");
  }
  return { tags: tags.some((item) => normalizeResourceTag(item).toLowerCase() === tag.toLowerCase()) ? tags : [...tags, tag] };
}

/** Only explicit web navigation is allowed; no file:, javascript: or app URIs. */
export function resourceWebUrl(value: string): string | undefined {
  const input = value.trim();
  if (!input || /[\s\\]/.test(input) || hasAsciiControl(input)) return undefined;
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(input);
  if (hasScheme && !/^https?:\/\//i.test(input)) return undefined;
  try {
    const url = new URL(hasScheme ? input : `https://${input}`);
    if (!url.hostname || url.username || url.password || !["https:", "http:"].includes(url.protocol)) return undefined;
    return url.href;
  } catch { return undefined; }
}
