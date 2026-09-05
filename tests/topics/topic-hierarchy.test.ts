import { describe, expect, it } from "vitest";
import { indexEmberlyFiles, childrenOf } from "../../src/maps/model";
import { appendTopicOrder, compareOrder, isOrderKey, topicMoveProperties } from "../../src/topics/topic-hierarchy";
import { generateKeyBetween } from "../../src/topics/fractions";
import { MarkdownNodeCollection } from "../../src/emberly-engine/adapter/markdown-collection";
import { Entity } from "../../src/emberly-engine/adapter/dataplane";
import { MapFileChanges } from "../../src/maps/map-file-changes";
import type { SourceFile } from "../../src/shared/types";

const source = (id: string, parent?: string, order = "a0"): SourceFile => ({ path: `M/${id}.md`, basename: id,
  frontmatter: { emberly: "topic", "emberly-format": 2, "emberly-id": id, "emberly-map": "map",
    ...(parent ? { "emberly-parent": parent, "emberly-order": order } : {}) },
});
const files = (): SourceFile[] => [{ path: "M/Map.md", basename: "Map", content: "Freeform prose, not a hierarchy",
  frontmatter: { emberly: "map", "emberly-format": 2, "emberly-id": "map", "emberly-root-id": "root", "emberly-layout": "center" } },
  source("a", "root"), source("b", "root", "a1"), source("child", "a")];
const map = () => indexEmberlyFiles(files())[0]!;

describe("legacy fractional keys and topic-owned parents", () => {
  it("matches legacy ordering vectors and uses code-point, not locale, collation", () => {
    expect(generateKeyBetween(null, null)).toBe("a0");
    expect(generateKeyBetween(null, "a0")).toBe("Zz");
    expect(generateKeyBetween("a0", null)).toBe("a1");
    expect(generateKeyBetween("a0", "a1")).toBe("a0V");
    expect(["a0a", "a0Z", "Zz", "a0"].sort(compareOrder)).toEqual(["Zz", "a0", "a0Z", "a0a"]);
    expect(Entity.Compare({ index: "a0Z" }, { index: "a0a" })).toBeLessThan(0);
  });
  it("inserts repeatedly into the same gap without numeric precision loss or renumbering", () => {
    let next = "a1";
    const keys = new Set(["a0", next]);
    for (let i = 0; i < 2000; i++) {
      const key = generateKeyBetween("a0", next);
      expect(key > "a0" && key < next).toBe(true);
      expect(isOrderKey(key)).toBe(true);
      expect(keys.has(key)).toBe(false);
      keys.add(key); next = key;
    }
  });
  it.each([undefined, null, 1, "1", "", "a", "a00", "a0!", "a0 ", "A00000000000000000000000000"])("rejects invalid key %j", (value) => {
    expect(isOrderKey(value)).toBe(false);
  });
  it("moves only a branch's top-level relationship and uses a fractional destination key", () => {
    const current = map();
    expect(current.issues).toEqual([]);
    const patch = topicMoveProperties(current, { id: "a", parentId: "b", previousParentId: "root", previousSiblingId: null, nextSiblingId: null });
    expect(patch).toEqual({ "emberly-parent": "b", "emberly-order": "a0" });
    const input = files(); Object.assign(input.find((file) => file.basename === "a")!.frontmatter, patch);
    const result = indexEmberlyFiles(input)[0]!;
    expect(result.issues).toEqual([]);
    expect(childrenOf(result, "a").map((node) => node.id)).toEqual(["child"]);
    expect(appendTopicOrder(current, "root")).toBe("a2");
  });
  it.each([
    { id: "root", parentId: "a" }, { id: "a", parentId: null }, { id: "a", parentId: "a" },
    { id: "a", parentId: "child" }, { id: "a", parentId: "foreign" },
    { id: "a", parentId: "b", previousParentId: "child" },
    { id: "child", parentId: "root", previousSiblingId: "missing" },
    { id: "child", parentId: "root", previousSiblingId: null, nextSiblingId: null },
  ])("rejects an invalid or stale move %j", (move) => expect(() => topicMoveProperties(map(), move)).toThrow());
  it.each([
    { "emberly-parent": undefined }, { "emberly-parent": "foreign" }, { "emberly-parent": "child" },
    { "emberly-parent": "a" }, { "emberly-order": 1 }, { "emberly-format": 1 },
  ])("reports malformed hierarchy without guessing a parent: %j", (patch) => {
    const input = files(); Object.assign(input[1]!.frontmatter, patch);
    expect(indexEmberlyFiles(input)[0]!.issues.length).toBeGreaterThan(0);
  });
  it("does not infer membership from folders; duplicate keys use stable IDs across renames", () => {
    const input = files(); input[2]!.frontmatter["emberly-order"] = "a0";
    const unrelated = source("unrelated", "root"); delete unrelated.frontmatter["emberly-map"]; input.push(unrelated);
    input[1]!.path = "Moved/Z renamed.md"; input[2]!.path = "Moved/A renamed.md";
    const current = indexEmberlyFiles(input)[0]!;
    expect(current.issues).toEqual([]);
    expect(childrenOf(current, "root").map((node) => node.id)).toEqual(["a", "b"]);
    expect(current.nodes.some((node) => node.id === "unrelated")).toBe(false);
  });
  it("uses string keys in the live renderer and retains them when adding a topic", () => {
    const current = map(), collection = new MarkdownNodeCollection(current, () => {});
    const a = collection.getEntityById("a")!, b = collection.getEntityById("b")!;
    b.placeBetween(undefined, a, { sync: false });
    expect(b.index).toBe("Zz");
    const reloaded = { ...current, nodes: current.nodes.map((node) => node.id === "b" ? { ...node, order: "Zz" } : node) };
    expect(collection.matchesStructure(reloaded)).toBe(true);
    const added = collection.addNode({ ...current.nodes.find((node) => node.id === "a")!, id: "new", order: "a0V" });
    expect(added?.index).toBe("a0V");
  });
  it("preserves an exact renderer key when opposite sides share an ordering key", () => {
    const current = map();
    current.nodes.find((node) => node.id === "b")!.order = "a0V";
    const patch = topicMoveProperties(current, { id: "child", parentId: "root", previousParentId: "a", index: "a0V",
      previousSiblingId: "b", nextSiblingId: null });
    expect(patch["emberly-order"]).toBe("a0V");
    expect(() => topicMoveProperties(current, { id: "child", parentId: "root", index: "a2",
      previousSiblingId: "a", nextSiblingId: "b" })).toThrow("fits between");
  });
  it("ignores map-body edits and recognizes parent and ordering edits", () => {
    const input = files(), changes = new MapFileChanges(); changes.reset(input);
    expect(changes.record({ ...input[0]!, content: "<!-- emberly-outline:start -->\ninvalid outline\n" })).toBeUndefined();
    expect(changes.record({ ...input[1]!, frontmatter: { ...input[1]!.frontmatter, "emberly-order": "Zz" } })?.appearanceOnly).toBe(false);
  });
});
