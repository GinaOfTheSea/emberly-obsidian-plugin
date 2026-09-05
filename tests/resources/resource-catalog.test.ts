import { describe, expect, it } from "vitest";
import { buildResourceCatalog, nextResourceOrder, resourceMembershipSignature, withResourceFlags } from "../../src/resources/resource-catalog";
import { MapFileChanges } from "../../src/maps/map-file-changes";
import type { EmberlyMap, EmberlyNode, SourceFile } from "../../src/shared/types";

const topic = (id: string, parentId: string | null): EmberlyNode => ({ id, path: id === "root" ? "a/Map.md" : `a/Topics/${id}.md`, title: "Same", mapId: "a", parentId, order: 1, side: "right", color: 1, collapsed: false, rating: 2, state: 15 });
const maps: EmberlyMap[] = [{ id: "a", path: "a/Map.md", folder: "a", title: "A", format: 2, layout: "center", nodes: [topic("root", null), topic("one", "root"), topic("two", "root")], issues: [] }];
const resource = (id: string, patch: Record<string, unknown> = {}): SourceFile => ({ path: `a/Resources/${id}.md`, basename: id,
  frontmatter: { emberly: "resource", "emberly-format": 2, "emberly-id": id, "emberly-map": "a", "emberly-topic": "one", "emberly-order": 1, ...patch },
});

describe("resource-owned catalog", () => {
  it("uses IDs, independent of names, paths or a topic's old managed list", () => {
    const a = { ...resource("r"), path: "Somewhere/renamed.md" };
    const catalog = buildResourceCatalog([a], maps);
    expect(catalog.issues).toEqual([]);
    expect(catalog.resources[0]).toMatchObject({ topicId: "one", path: "Somewhere/renamed.md" });
  });
  it("displays newest order first with a deterministic ID tie-breaker", () => {
    const catalog = buildResourceCatalog([resource("b"), resource("a"), resource("new", { "emberly-order": 2 })], maps);
    expect(catalog.resources.map((item) => item.id)).toEqual(["new", "a", "b"]);
    expect(nextResourceOrder(catalog.resources, "a", "one")).toBe(3);
    expect(nextResourceOrder(catalog.resources, "a", "two")).toBe(1);
  });
  it("rejects duplicate IDs globally, including across maps", () => {
    const catalog = buildResourceCatalog([resource("same"), { ...resource("same", { "emberly-map": "b" }), path: "b/Resources/Copy.md" }], maps);
    expect(catalog.resources).toEqual([]);
    expect(catalog.issues.every((issue) => issue.message.includes("Duplicate"))).toBe(true);
  });
  it.each([
    { "emberly-topic": "absent" }, { "emberly-topic": "One?" }, { "emberly-id": "bad id" },
    { "emberly-map": "missing" }, { "emberly-order": "1" }, { "emberly-order": -1 },
    { "emberly-order": NaN }, { "emberly-order": Number.MAX_SAFE_INTEGER + 1 },
  ])("reports invalid resource ownership instead of attaching it to a guessed topic: %j", (patch) => {
    const catalog = buildResourceCatalog([resource("r", patch)], maps);
    expect(catalog.resources).toEqual([]); expect(catalog.issues).toHaveLength(1);
  });
  it("does not reinterpret resource format 1 recovery fields as ownership", () => {
    const catalog = buildResourceCatalog([resource("old", { "emberly-format": 1 })], maps);
    expect(catalog.resources).toEqual([]); expect(catalog.issues[0]?.message).toContain("Re-export");
  });
  it("blocks ambiguous maps and invalid outlines", () => {
    expect(buildResourceCatalog([resource("r")], [maps[0]!, { ...maps[0]!, path: "Copy.md" }]).resources).toEqual([]);
    expect(buildResourceCatalog([resource("r")], [{ ...maps[0]!, issues: ["bad outline"] }]).resources).toEqual([]);
  });
  it("counts every owned resource, ignoring old archive flags and preserving plan/notes bits", () => {
    const catalog = buildResourceCatalog([resource("active"), resource("archived", { "emberly-topic": "two", "emberly-archived": true })], maps);
    const result = withResourceFlags(maps, catalog);
    expect(result[0]!.nodes.map((node) => node.state)).toEqual([11, 15, 15]);
    expect(maps[0]!.nodes[2]!.state).toBe(15);
  });
  it("does not treat resource note typing, tags or timestamps as a map change", () => {
    const original = resource("r"), after = { ...original, content: "New body", frontmatter: { ...original.frontmatter, modified: "now", tags: ["new"] } };
    const changes = new MapFileChanges(); changes.reset([original]);
    expect(changes.record(after)).toBeUndefined();
    expect(resourceMembershipSignature(original.frontmatter)).toBe(resourceMembershipSignature(after.frontmatter));
    expect(resourceMembershipSignature({ ...after.frontmatter, archived: true, "emberly-archived": true })).toBe(resourceMembershipSignature(original.frontmatter));
    expect(resourceMembershipSignature({ ...after.frontmatter, "emberly-topic": "two" })).not.toBe(resourceMembershipSignature(original.frontmatter));
  });
  it("refuses order overflow", () => {
    const catalog = buildResourceCatalog([resource("r", { "emberly-order": Number.MAX_SAFE_INTEGER })], maps);
    expect(() => nextResourceOrder(catalog.resources, "a", "one")).toThrow("exhausted");
  });
});
