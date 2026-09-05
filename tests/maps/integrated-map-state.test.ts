import { describe, expect, it } from "vitest";
import { belongsToIntegratedMap, inspectorWidth } from "../../src/maps/integrated-map-state";
import type { EmberlyMap } from "../../src/shared/types";

const map: EmberlyMap = { id: "a", format: 2, path: "a/Map.md", title: "Map", folder: "a", layout: "center", nodes: [], issues: [] };

describe("integrated map boundaries", () => {
  it("uses identity rather than folders for resource membership", () => {
    expect(belongsToIntegratedMap(map, "elsewhere/Resource.md", { emberly: "resource", "emberly-map": "a" })).toBe(true);
    expect(belongsToIntegratedMap(map, "a/Resources/Other.md", { emberly: "resource", "emberly-map": "b" })).toBe(false);
    expect(belongsToIntegratedMap(map, "a/Notes.md", {})).toBe(false);
    expect(belongsToIntegratedMap(map, map.path, {})).toBe(true);
  });
  it("bounds inspector sizing and retains space for the map", () => {
    expect(inspectorWidth(380, 1200)).toBe(380);
    expect(inspectorWidth(800, 1200)).toBe(720);
    expect(inspectorWidth(720, 700)).toBe(414);
    expect(inspectorWidth(-1, 1200)).toBe(240);
    expect(inspectorWidth(NaN, 1200)).toBe(380);
    expect(inspectorWidth(380, 0)).toBe(240);
  });
});
