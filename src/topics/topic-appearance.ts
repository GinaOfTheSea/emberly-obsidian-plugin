export interface TopicAppearance { color: number; rating: number; state: number; }
export interface TopicIdentity { id: string; mapId: string; }
export type TopicAppearanceChange = { color: number } | { rating: number } | { plan: 0 | 1 | 2 };

// Original Emberly ColorSelect palette, in its original order.
export const TOPIC_COLORS = [
  "#009AA0", "#48B4B8", "#77C4C7", "#0093D1", "#48AFDA", "#77C0DF",
  "#5484FF", "#83A4FA", "#A1B9F6", "#A968FF", "#BE91FA", "#CBABF6",
  "#EA6888", "#F197A9", "#EFAEBA", "#707070", "#ABABAB",
];

export function readTopicAppearance(properties: Record<string, unknown>): TopicAppearance {
  const integer = (key: string, fallback: number, min: number, max: number): number => {
    const value = properties[key];
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  };
  return {
    color: integer("emberly-color", -1, -1, 0xffffff),
    rating: integer("emberly-rating", 0, 0, 5),
    state: integer("emberly-state", 0, 0, 0x7fffffff),
  };
}

export function colorHex(color: number): string { return `#${Math.max(0, color).toString(16).padStart(6, "0").toUpperCase()}`; }

/** Only the requested property changes. Plan uses two bits; note/resource flags survive. */
export function appearanceProperties(properties: Record<string, unknown>, change: TopicAppearanceChange): Record<string, number> {
  if (Object.keys(change).length !== 1) throw new Error("Change one topic setting at a time.");
  if ("color" in change && Number.isInteger(change.color) && change.color >= -1 && change.color <= 0xffffff) {
    return { "emberly-color": change.color };
  }
  if ("rating" in change && Number.isInteger(change.rating) && change.rating >= 0 && change.rating <= 5) {
    return { "emberly-rating": change.rating };
  }
  if ("plan" in change && [0, 1, 2].includes(change.plan)) {
    const state = properties["emberly-state"] ?? 0;
    if (typeof state !== "number" || !Number.isInteger(state) || state < 0 || state > 0x7fffffff) throw new Error("The topic has an invalid plan/state property. Fix it in Details first.");
    return { "emberly-state": (state & ~3) | change.plan };
  }
  throw new Error("Invalid topic setting.");
}
