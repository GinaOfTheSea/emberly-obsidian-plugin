import { describe, expect, it } from "vitest";
import { childrenOf, indexEmberlyFiles } from "../../src/maps/model";
import type { SourceFile } from "../../src/shared/types";

const file = (path: string, frontmatter: Record<string, unknown>): SourceFile => ({
  path, basename: path.split("/").pop()!.replace(/\.md$/, ""), frontmatter,
});
const oneMap = (files: SourceFile[]) => {
  const map = indexEmberlyFiles(files)[0];
  if (!map) throw new Error("Expected one map");
  return map;
};

describe("Emberly Markdown index", () => {
  it("hides the compound map marker from map and root labels only", () => {
    const map = oneMap([
      file("Maps/Sailing/Sailing.emberly.md", { emberly: "map", "emberly-format": 2, "emberly-id": "map", "emberly-root-id": "root", "emberly-layout": "center" }),
      file("Maps/Sailing/Topics/Keep.emberly.md", { emberly: "topic", "emberly-format": 2, "emberly-id": "topic", "emberly-map": "map", "emberly-parent": "root", "emberly-order": "a0" }),
    ]);
    expect(map.title).toBe("Sailing");
    expect(map.nodes.find((node) => node.id === "root")?.title).toBe("Sailing");
    expect(map.nodes.find((node) => node.id === "topic")?.title).toBe("Keep.emberly");
  });

  it("uses topic parent IDs, not outline links, names or folder nesting", () => {
    const source = file("Map/Map.md", { emberly: "map", "emberly-format": 2, "emberly-id": "map", "emberly-root-id": "root", "emberly-layout": "center" });
    source.content = "An obsolete or malformed outline is just body text.";
    const topic = (path: string, id: string, parent: string | null) => file(path, {
      emberly: "topic", "emberly-format": 2, "emberly-id": id, "emberly-map": "map",
      title: "Same", ...(parent ? { "emberly-parent": parent, "emberly-order": "a0" } : {}),
    });
    const map = oneMap([source, topic("Moved/renamed.md", "a", "root"), topic("Map/Topics/b.md", "b", "a")]);
    expect(map.issues).toEqual([]);
    expect(map.nodes.find((node) => node.id === "a")).toMatchObject({ parentId: "root", order: "a0", title: "renamed", path: "Moved/renamed.md" });
    expect(childrenOf(map, "a").map((node) => node.id)).toEqual(["b"]);
  });

  it("does not fall back to folder structure for unsupported formats", () => {
    const map = oneMap([file("M.md", { emberly: "map", "emberly-format": 42, "emberly-id": "m" })]);
    expect(map.nodes).toEqual([]);
    expect(map.issues[0]).toContain("Unsupported Emberly format");
  });

  it("blocks duplicate map notes and duplicate topic IDs rather than choosing a write target", () => {
    const source = file("Map.md", { emberly: "map", "emberly-format": 2, "emberly-id": "map", "emberly-root-id": "root" });
    const topic = file("Topic.md", { emberly: "topic", "emberly-format": 2, "emberly-id": "topic", "emberly-map": "map", "emberly-parent": "root", "emberly-order": "a0" });
    const maps = indexEmberlyFiles([source, { ...source, path: "Map copy.md" }, topic]);
    expect(maps).toHaveLength(2);
    expect(maps.every((map) => map.issues.some((issue) => issue.includes("Duplicate map ID")))).toBe(true);
    const map = oneMap([source, topic, { ...topic, path: "Topic copy.md" }]);
    expect(map.issues.some((issue) => issue.includes("Duplicate topic ID"))).toBe(true);
  });

  it("reports malformed parent graphs", () => {
    const map = oneMap([
      file("M/M.emberly.md", { emberly: "map", "emberly-format": 2, "emberly-id": "m", "emberly-root-id": "root" }),
      file("M/Topics/a.md", { emberly: "topic", "emberly-format": 2, "emberly-id": "a", "emberly-map": "m", "emberly-parent": "b", "emberly-order": "a0" }),
      file("M/Topics/b.md", { emberly: "topic", "emberly-format": 2, "emberly-id": "b", "emberly-map": "m", "emberly-parent": "a", "emberly-order": "a1" }),
    ]);
    expect(map.issues.some((issue) => issue.includes("cycle"))).toBe(true);
  });
});
