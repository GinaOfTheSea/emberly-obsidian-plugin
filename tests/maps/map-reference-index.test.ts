import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedMetadata } from "obsidian";
import { MapReferenceIndex } from "../../src/maps/map-reference-index";
import { ResourceFixture, note } from "../helpers/resource-fixture";

const bodyCache = (links: string[] = [], embeds: string[] = []): CachedMetadata => ({
  links: links.map((link) => ({ link, original: `[[${link}]]`, displayText: "An alias" })),
  embeds: embeds.map((link) => ({ link, original: `![[${link}]]` })),
} as CachedMetadata);

describe("derived map references (public cached-link adapter)", () => {
  let fixture: ResourceFixture, index: MapReferenceIndex;
  const one = "a/Topics/one.md", two = "a/Topics/two.md", resource = "a/Resources/Guide.md";
  const refreshOwners = () => index.syncOwnership(fixture.index.maps(), fixture.index.resourceCatalog().resources);
  const update = (path: string, links: string[] = [], embeds: string[] = []) => {
    index.update(path, bodyCache(links, embeds), (link, from) => fixture.app.metadataCache.getFirstLinkpathDest(link, from));
  };
  beforeEach(async () => { fixture = await ResourceFixture.create(); index = new MapReferenceIndex(); refreshOwners(); });
  afterEach(async () => { await fixture.dispose(); });

  it("combines outgoing, incoming, reciprocal and duplicate links into one destination", () => {
    update(one, [two, two]); update(two, [one]);
    expect(index.selection("a/Map.md", one)).toEqual({ sourceNodeId: "a-one", targetNodeIds: ["a-two"] });
    expect(index.selection("a/Map.md", two)?.targetNodeIds).toEqual(["a-one"]);
    update(one); // A backlink still exists.
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual(["a-two"]);
    update(two);
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual([]);
  });

  it("delegates aliases, source-relative paths and headings/blocks to native resolution", () => {
    const resolve = vi.fn((link: string, from: string) => fixture.app.metadataCache.getFirstLinkpathDest(link, from));
    index.update(one, bodyCache(["two.md#Heading", "../Topics/two.md#^block"], ["a/Topics/two#Other"]), resolve);
    expect(resolve.mock.calls).toEqual([["two.md", one], ["../Topics/two.md", one], ["a/Topics/two", one]]);
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual(["a-two"]);
  });

  it("reads only body links/embeds, never frontmatterLinks or map outlines", () => {
    const cache = { ...bodyCache(), frontmatterLinks: [{ link: two }] } as CachedMetadata;
    index.update(one, cache, (link, from) => fixture.app.metadataCache.getFirstLinkpathDest(link, from));
    update("a/Map.md", [one, two]);
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual([]);
    expect(index.selection("a/Map.md", "a/Map.md")).toBeNull();
    update(one, [], [two]);
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual(["a-two"]);
  });

  it("excludes plain notes, uploaded Markdown, external URLs, unresolved and cross-map links", async () => {
    await fixture.addFile("Notes/Other.md", note({}, `[[${one}]]`));
    await fixture.addFile("a/Assets/imported.md", note({ emberly: "topic", "emberly-format": 2, "emberly-id": "fake", "emberly-map": "a" }, `[[${one}]]`));
    refreshOwners();
    update(one, ["Notes/Other.md", "a/Assets/imported.md", "b/Topics/one.md", "missing", "https://example.org", "obsidian://open", "//example.org"]);
    update("Notes/Other.md", [one]); update("a/Assets/imported.md", [one]); update("b/Topics/two.md", [one]);
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual([]);
    expect(index.selection("a/Map.md", "Other.md")).toBeNull();
    expect(index.selection("b/Map.md", one)).toBeNull();
  });

  it("never aggregates resource links or resource backlinks when selecting their owner", () => {
    update(resource, [two]); update(two, [resource]);
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual([]);
    expect(index.selection("a/Map.md", resource)).toEqual({ sourceNodeId: "a-one", targetNodeIds: ["a-two"] });
    expect(index.selection("a/Map.md", two)?.targetNodeIds).toEqual(["a-one"]);
  });

  it("projects resource-to-resource links to owners, including inbound-only links", async () => {
    await fixture.addFile("a/Resources/Second.md", note({ emberly: "resource", "emberly-format": 2, "emberly-id": "second", "emberly-map": "a", "emberly-topic": "a-two", "emberly-order": 1 }));
    refreshOwners(); update("a/Resources/Second.md", [resource]);
    expect(index.selection("a/Map.md", resource)?.targetNodeIds).toEqual(["a-two"]);
    expect(index.selection("a/Map.md", "a/Resources/Second.md")?.targetNodeIds).toEqual(["a-one"]);
    expect(index.selection("a/Map.md", two)?.targetNodeIds).toEqual([]);
  });

  it("deduplicates topics/resources with the same owner and removes self-connections after projection", () => {
    update(two, [one, resource]); update(one, [one, "#Heading", "#^block", resource]); update(resource, [one, resource]);
    expect(index.selection("a/Map.md", two)?.targetNodeIds).toEqual(["a-one"]);
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual(["a-two"]);
    expect(index.selection("a/Map.md", resource)?.targetNodeIds).toEqual(["a-two"]);
  });

  it("excludes the map document/root from reference connections", () => {
    update(one, ["a/Map.md"]);
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual([]);
    expect(index.selection("a/Map.md", "a/Map.md")).toBeNull();
  });

  it("adds previously unresolved links when the public cache resolves a new resource", async () => {
    update(two, ["Later"]);
    expect(index.selection("a/Map.md", two)?.targetNodeIds).toEqual([]);
    await fixture.addFile("a/Resources/Later.md", note({ emberly: "resource", "emberly-format": 2, "emberly-id": "later", "emberly-map": "a", "emberly-topic": "a-one", "emberly-order": 1 }));
    refreshOwners(); update(two, ["Later"]);
    expect(index.selection("a/Map.md", two)?.targetNodeIds).toEqual(["a-one"]);
  });

  it("reprojects after same-map and cross-map resource moves without aggregating owner notes", async () => {
    update(resource, [two]);
    await fixture.mover().move(fixture.resource, fixture.target("a", "two")); refreshOwners();
    expect(index.selection("a/Map.md", resource)).toEqual({ sourceNodeId: "a-two", targetNodeIds: [] });
    update(resource, [one]);
    expect(index.selection("a/Map.md", resource)?.targetNodeIds).toEqual(["a-one"]);
    await fixture.mover().move(fixture.resource, fixture.target("b", "one")); refreshOwners();
    const moved = fixture.resource.path;
    update(moved, [one]);
    expect(index.selection("a/Map.md", moved)).toBeNull();
    expect(index.selection("b/Map.md", moved)).toEqual({ sourceNodeId: "b-one", targetNodeIds: [] });
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual([]);
  });

  it("drops invalid/ambiguous ownership and all its inbound/outbound projections", async () => {
    update(resource, [two]); update(two, [resource]);
    const file = fixture.index.file(resource)!;
    fixture.index.setContent(resource, note({ ...fixture.index.propertiesFor(file), "emberly-topic": "missing" }));
    refreshOwners();
    expect(index.selection("a/Map.md", resource)).toBeNull();
    expect(index.selection("a/Map.md", two)?.targetNodeIds).toEqual([]);
    const maps = fixture.index.maps();
    index.syncOwnership([...maps, maps[0]!], []);
    expect(index.selection("a/Map.md", one)).toBeNull();
  });

  it("rebuilds after rename/deletion and cleans reverse edges on disposal", async () => {
    update(resource, [two]);
    const file = fixture.index.file(resource)!;
    await fixture.app.fileManager.renameFile(file, "a/Resources/Renamed.md");
    refreshOwners(); update(file.path, [two]);
    expect(index.selection("a/Map.md", resource)).toBeNull();
    expect(index.selection("a/Map.md", two)?.targetNodeIds).toEqual(["a-one"]);
    await fixture.app.fileManager.trashFile(file); refreshOwners();
    expect(index.selection("a/Map.md", two)?.targetNodeIds).toEqual([]);
    index.clear();
    expect(index.paths()).toEqual([]);
    expect(index.selection("a/Map.md", two)).toBeNull();
  });

  it("reads wikilink/Markdown aliases and embeds from an isolated note without writing data", async () => {
    const file = fixture.index.file(one)!;
    const content = note(fixture.index.propertiesFor(file), `[[two|Alias]] [Other label](<../Topics/two.md#Heading>) ![[two#^block]]\nNot a link to Guide.`);
    await fixture.app.vault.process(file, () => content); fixture.index.setContent(one, content);
    const before = fixture.mutations.slice();
    index.update(one, fixture.app.metadataCache.getFileCache(file), (link, from) => fixture.app.metadataCache.getFirstLinkpathDest(link, from));
    expect(index.selection("a/Map.md", one)?.targetNodeIds).toEqual(["a-two"]);
    expect(fixture.mutations).toEqual(before);
  });
});
