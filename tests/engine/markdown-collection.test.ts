import { describe, expect, it } from "vitest";
import { MarkdownNodeCollection, type EngineEntitySnapshot } from "../../src/emberly-engine/adapter/markdown-collection";
import type { EmberlyMap, EmberlyNode } from "../../src/shared/types";

const node = (id: string, parentId: string | null, order: number): EmberlyNode => ({
  id, parentId, order, path: `${id}.md`, title: id, mapId: "map", side: parentId ? "right" : "center",
  color: -1, collapsed: false, rating: 0, state: 0,
});
const map: EmberlyMap = { id: "map", format: 2, path: "map.md", folder: "", title: "Map", layout: "center", issues: [], nodes: [
  node("root", null, 1), node("a", "root", 1), node("b", "root", 2), node("child", "a", 1),
] };

describe("original-engine Markdown adapter", () => {
  it("matches live topology after local collapse/drag with fractional indices, independently of renamed filenames", () => {
    const collection = new MarkdownNodeCollection(map, () => {});
    expect(collection.matchesStructure(map)).toBe(true);
    collection.getEntityById("a")!.setIndex(20, { sync: false });
    collection.getEntityById("b")!.setIndex(10.5, { sync: false });
    collection.getEntityById("a")!.setIsCollapsed(true, { sync: false });
    expect(collection.matchesStructure(map)).toBe(false);
    const saved = { ...map, path: "Renamed map.md", nodes: map.nodes.map((node) => ({ ...node,
      title: "Renamed " + node.title, path: "Moved/" + node.path,
      order: node.id === "a" ? 2 : node.id === "b" ? 1 : node.order, collapsed: node.id === "a",
    })) };
    expect(collection.matchesStructure(saved)).toBe(true);
  });
  it("updates filename and source path in place without persistence or unrelated state changes", async () => {
    const writes: EngineEntitySnapshot[] = [];
    const collection = new MarkdownNodeCollection(map, (snapshot) => { writes.push(snapshot); });
    const entity = collection.getEntityById("a")!;
    const updates: string[] = [];
    collection.externalEvents.on("updated", (node) => updates.push(node.id));
    collection.reconcileIdentity({ ...map.nodes[1]!, title: "New name", path: "Elsewhere/New name.md" });
    expect(collection.getEntityById("a")).toBe(entity);
    expect(entity).toMatchObject({ name: "New name", sourcePath: "Elsewhere/New name.md", parentId: "root", index: 1 });
    collection.reconcileIdentity({ ...map.nodes[1]!, title: "New name", path: "Elsewhere/New name.md" });
    expect(updates).toEqual(["a"]);
    expect(writes).toEqual([]);
    entity.setRating(4);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes[0]).toMatchObject({ name: "New name", sourcePath: "Elsewhere/New name.md", changed: ["rating"] });
  });
  it("provides the collection contract used by TreeRenderer", async () => {
    const writes: EngineEntitySnapshot[] = [];
    const collection = new MarkdownNodeCollection(map, (snapshot) => { writes.push(snapshot); });
    expect(await collection.loadEverything()).toBe(true);
    expect(collection.entityIndex.find((entity) => entity.id === "child")?.depth).toBe(2);
    expect(collection.context.getConnections().setActiveInput()).toBe(true);
  });

  it("turns engine mutations into serializable Markdown snapshots", async () => {
    const writes: EngineEntitySnapshot[] = [];
    const collection = new MarkdownNodeCollection(map, (snapshot) => { writes.push(snapshot); });
    const child = collection.getEntityById("child")!;
    child.setColor(0x336699, { sync: false });
    child.unsetColor({ sync: false });
    child.setIsCollapsed(true, { sync: false });
    child.setParentId("b", { sync: false, refresh: true });
    child.setSide(-1, { sync: false });
    expect(writes).toHaveLength(0);
    child.update("updated", { instanceId: "renderer" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toHaveLength(1);
    expect(writes.at(-1)).toMatchObject({ id: "child", parentId: "b", parentName: "b", side: -1, isCollapsed: true });
  });

  it("adds a newly indexed topic to the running collection", () => {
    const collection = new MarkdownNodeCollection(map, () => undefined);
    const created: string[] = [];
    collection.externalEvents.on("created", (entity) => created.push(entity.id));

    const entity = collection.addNode(node("new-child", "child", 1));

    expect(entity).toMatchObject({ id: "new-child", parentId: "child", depth: 3 });
    expect(collection.getEntityById("new-child")).toBe(entity);
    expect(collection.entityIndex).toHaveLength(5);
    expect(created).toEqual(["new-child"]);
    expect(collection.addNode(node("new-child", "child", 1))).toBeUndefined();
  });

  it("appends new topics after live indices changed by prior drags", () => {
    const collection = new MarkdownNodeCollection(map, () => undefined);
    collection.getEntityById("a")!.setIndex(10, { sync: false });
    collection.getEntityById("b")!.setIndex(20, { sync: false });
    const added = collection.addNode(node("new", "root", 3))!;
    expect(added.index).toBe(21);
    expect(collection.snapshot(added).previousSiblingId).toBe("b");
  });

  it("records the changed fields and stable neighbors for each queued move", async () => {
    const writes: EngineEntitySnapshot[] = [];
    const collection = new MarkdownNodeCollection(map, (snapshot) => { writes.push(snapshot); });
    const b = collection.getEntityById("b")!;
    b.placeBetween(undefined, collection.getEntityById("a"));
    b.setIsCollapsed(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes[0]).toMatchObject({ changed: ["index"], previousParentId: "root", previousSiblingId: null, nextSiblingId: "a" });
    expect(writes[1]?.changed).toEqual(["isCollapsed"]);
  });
});
