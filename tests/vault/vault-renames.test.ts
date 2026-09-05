import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rename } from "node:fs/promises";
import { EmberlyVaultIndex } from "../../src/vault/vault-index";
import { MapReferenceIndex } from "../../src/maps/map-reference-index";
import { ResourceFixture, note } from "../helpers/resource-fixture";
import { TFile } from "../helpers/obsidian-mock";

describe("native renames with delayed metadata (isolated vault)", () => {
  let fixture: ResourceFixture, index: EmberlyVaultIndex;
  beforeEach(async () => {
    fixture = await ResourceFixture.create();
    index = new EmberlyVaultIndex(fixture.app);
    await index.initialize(); index.sources(); // warm native identities, no local property overrides
  });
  afterEach(async () => { vi.restoreAllMocks(); await fixture.dispose(); });

  it.each([
    ["a/Map.md", "a/Sailing renamed.md"],
    ["a/Topics/one.md", "a/Topics/Changed.md"], ["a/Resources/Guide.md", "a/Resources/Manual.pdf.md"],
  ])("retains identities/ownership across %s → %s", async (oldPath, path) => {
    const before = index.maps().find((map) => map.id === "a")!;
    const file = index.file(oldPath)!;
    const content = await fixture.read(oldPath);
    await fixture.app.fileManager.renameFile(file, path);
    const cache = vi.spyOn(fixture.app.metadataCache, "getFileCache").mockReturnValue(null);
    index.rename(path, oldPath);
    for (let attempt = 0; attempt < 3; attempt++) {
      const map = index.maps().find((map) => map.id === "a")!;
      expect(map.issues).toEqual([]);
      expect(map.nodes.map((node) => [node.id, node.parentId])).toEqual(before.nodes.map((node) => [node.id, node.parentId]));
      expect(index.resourceCatalog().resources[0]).toMatchObject({ id: "resource", mapId: "a", topicId: "a-one" });
    }
    expect(await index.initialize()).toBe(false);
    cache.mockRestore();
    expect(await fixture.read(path)).toBe(content);
    index.setContent(path, content); // delayed native metadata.changed
    const map = index.maps().find((map) => map.id === "a")!;
    expect(map.issues).toEqual([]);
    if (oldPath === "a/Map.md") {
      expect(map.title).toBe("Sailing renamed");
      expect(map.nodes.find((node) => !node.parentId)?.path).toBe("a/Sailing renamed.md");
    } else if (oldPath.includes("Topics")) expect(map.nodes.find((node) => node.path === path)?.title).toBe(file.basename);
    else expect(index.resourceCatalog().resources[0]?.title).toBe("Manual.pdf");
  });

  it("remaps outline, metadata and reference freshness caches for a folder rename", async () => {
    const before = index.maps().find((map) => map.id === "a")!;
    for (const source of index.sources()) {
      const content = await fixture.read(source.path);
      index.setContent(source.path, content);
      index.metadataObserved(source.path, content);
    }
    index.metadataPending("a/Topics/two.md");
    await rename(fixture.path("a"), fixture.path("Renamed folder"));
    for (const [path, file] of [...fixture.files]) if (path === "a" || path.startsWith("a/")) {
      fixture.files.delete(path); file.path = "Renamed folder" + path.slice(1); fixture.files.set(file.path, file);
    }
    index.rename("Renamed folder", "a");
    const cache = vi.spyOn(fixture.app.metadataCache, "getFileCache").mockReturnValue(null);
    const map = index.maps().find((map) => map.id === "a")!;
    expect(map.path).toBe("Renamed folder/Map.md"); expect(map.title).toBe("Map"); expect(map.issues).toEqual([]);
    expect(map.nodes.map((node) => [node.id, node.parentId])).toEqual(before.nodes.map((node) => [node.id, node.parentId]));
    expect(index.resourceCatalog().resources[0]?.path).toBe("Renamed folder/Resources/Guide.md");
    expect(index.referenceCacheCurrent("Renamed folder/Topics/one.md", "different")).toBe(false);
    expect(index.referenceCacheCurrent("Renamed folder/Topics/one.md", await fixture.read("Renamed folder/Topics/one.md"))).toBe(true);
    cache.mockRestore();
    expect(await index.initialize()).toBe(false);
    expect(index.sources().some((source) => source.path.startsWith("a/"))).toBe(false);
  });

  it("uses fresh absent metadata as a real deletion instead of resurrecting old identity", () => {
    const file = index.file("a/Topics/one.md")!;
    expect(index.propertiesFor(file)).toHaveProperty("emberly-id", "a-one");
    vi.spyOn(fixture.app.metadataCache, "getFileCache").mockReturnValue({});
    expect(index.propertiesFor(file)).toEqual({});
  });

  it("keeps native links/backlinks after renaming a map/folder without using outline link paths as ownership", async () => {
    const source = index.file("a/Topics/one.md")!;
    const data = note(index.propertiesFor(source), "[[two.md#Heading]] and [[../Resources/Guide.md]]\n");
    await fixture.app.vault.process(source, () => data);
    const refs = new MapReferenceIndex();
    const update = () => {
      refs.syncOwnership(index.maps(), index.resourceCatalog().resources);
      for (const path of refs.paths()) refs.update(path, fixture.app.metadataCache.getFileCache(index.file(path)!), fixture.app.metadataCache.getFirstLinkpathDest);
    };
    update(); expect(refs.selection("a/Map.md", source.path)?.targetNodeIds).toEqual(["a-two"]);
    await fixture.app.fileManager.renameFile(index.file("a/Map.md")!, "a/New map.md"); index.rename("a/New map.md", "a/Map.md");
    update();
    expect(refs.selection("a/New map.md", source.path)?.targetNodeIds).toEqual(["a-two"]);
    expect(refs.selection("a/New map.md", "a/Topics/two.md")?.targetNodeIds).toEqual(["a-one"]);
  });

  it("also excludes uploaded Markdown attachments while the map cache is temporarily missing", async () => {
    await fixture.addFile("a/Assets/fake.md", note({ emberly: "topic", "emberly-id": "fake", "emberly-map": "a" }));
    vi.spyOn(fixture.app.metadataCache, "getFileCache").mockReturnValue(null);
    expect(index.sources().some((file) => file.path === "a/Assets/fake.md")).toBe(false);
    expect(fixture.files.get("a/Assets/fake.md")).toBeInstanceOf(TFile);
  });
});
