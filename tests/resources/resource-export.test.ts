import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, basename } from "node:path";
import { describe, expect, it } from "vitest";
import { indexEmberlyFiles } from "../../src/maps/model";
import { buildResourceCatalog } from "../../src/resources/resource-catalog";
import type { SourceFile } from "../../src/shared/types";

describe("format-2 export fixtures", () => {
  it.each([
    { fixture: "resource-v2", mapCount: 2, resourceCount: 5 },
    { fixture: "seagulls", mapCount: 1, resourceCount: 5 },
  ])("$fixture has complete maps, unambiguous ownership, local assets and no topic resource lists", ({ fixture, mapCount, resourceCount }) => {
    const root = resolve("tests/fixtures", fixture);
    const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? walk(path) : entry.name.endsWith(".md") ? [path] : [];
    });
    const sources: SourceFile[] = walk(root).map((path) => {
      const content = readFileSync(path, "utf8"), header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
      const frontmatter: Record<string, unknown> = {};
      // These committed fixtures deliberately use JSON scalar/array YAML values.
      for (const line of header?.[1]?.split(/\r?\n/) ?? []) {
        const separator = line.indexOf(":");
        if (separator > 0) frontmatter[line.slice(0, separator)] = JSON.parse(line.slice(separator + 1));
      }
      return { path: relative(root, path).replace(/\\/g, "/"), basename: basename(path, ".md"), frontmatter, content };
    });
    const maps = indexEmberlyFiles(sources), catalog = buildResourceCatalog(sources, maps);
    expect(maps).toHaveLength(mapCount); expect(maps.flatMap((map) => map.issues)).toEqual([]);
    expect(catalog.issues).toEqual([]); expect(catalog.resources).toHaveLength(resourceCount);
    for (const resource of catalog.resources) {
      if (resource.asset) expect(readFileSync(resolve(root, maps.find((map) => map.id === resource.mapId)!.folder, resource.asset)).length).toBeGreaterThan(0);
    }
    for (const source of sources.filter((source) => source.frontmatter.emberly === "topic")) expect(source.content).not.toContain("emberly-resources");
  });
});
