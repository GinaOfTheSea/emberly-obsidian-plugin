import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { ResourceFixture, note } from "../helpers/resource-fixture";
import { createResources } from "../../src/resources/resource-create";
import { frontmatter } from "../../src/vault/vault-files";
import { byteHash, validateTransfer } from "../../src/resources/resource-transfer";

describe("resource-owned vault operations (isolated temporary files)", () => {
  let vault: ResourceFixture;
  beforeEach(async () => { vault = await ResourceFixture.create(); });
  afterEach(async () => { await vault.dispose(); });
  it("creates a resource without writing topic or map documents", async () => {
    const before = await vault.read("a/Topics/one.md");
    const result = await createResources(vault.app, vault.index, vault.target("a", "one"), { kind: "link", url: "https://example.com", title: "New link" }, () => {});
    expect(result.errors).toEqual([]); expect(result.added).toBe(1);
    expect(await vault.read("a/Topics/one.md")).toBe(before);
    expect(vault.mutations).toEqual(["create:a/Resources/New link.md"]);
    expect(vault.index.resourcesForTopic("a/Topics/one.md").resources.map((resource) => resource.title)).toEqual(["New link", "Guide"]);
    expect(frontmatter(await vault.read(result.paths[0]!)).properties).toMatchObject({
      "emberly-format": 2,
      "emberly-topic": "a-one",
      "emberly-topic-link": "[[../Topics/one]]",
    });
  });
  it("moves within a map using exactly one note write, keeping content and custom properties", async () => {
    const before = frontmatter(await vault.read(vault.resource.path));
    const process = vi.spyOn(vault.app.vault, "process");
    const properties = vi.spyOn(vault.app.fileManager, "processFrontMatter");
    await vault.mover().move(vault.resource, vault.target("a", "two"));
    const after = frontmatter(await vault.read("a/Resources/Guide.md"));
    expect(after.body).toBe(before.body); expect(after.properties.custom).toEqual({ keep: true });
    expect(after.properties.tags).toEqual(["research"]); expect(after.properties["emberly-topic"]).toBe("a-two");
    expect(after.properties["emberly-topic-link"]).toBe("[[../Topics/two]]");
    expect(vault.mutations).toEqual(["write:a/Resources/Guide.md"]);
    expect(properties).toHaveBeenCalledOnce();
    expect(process).not.toHaveBeenCalled();
    expect(vault.index.resourcesForTopic("a/Topics/one.md").resources).toHaveLength(0);
    expect(vault.index.maps().find((map) => map.id === "a")!.nodes.find((node) => node.id === "a-one")!.state & 4).toBe(0);
    expect(vault.index.maps().find((map) => map.id === "a")!.nodes.find((node) => node.id === "a-two")!.state).toBe(12);
  });
  it("preserves uploaded empty, extensionless and Markdown attachment bytes without indexing them as maps", async () => {
    const markdown = note({ emberly: "map", "emberly-format": 1, "emberly-id": "fake-map" }, "# Opaque attachment\n");
    const files = [new File([], "empty"), new File([new Uint8Array([0, 255, 3])], "data.bin"), new File([markdown], "uploaded.md")];
    const result = await createResources(vault.app, vault.index, vault.target("a", "one"), { kind: "offline", files }, () => {});
    expect(result.errors).toEqual([]); expect(result.added).toBe(3);
    expect((await readFile(vault.path("a/Assets/empty"))).length).toBe(0);
    expect([...await readFile(vault.path("a/Assets/data.bin"))]).toEqual([0, 255, 3]);
    expect(await vault.read("a/Assets/uploaded.md")).toBe(markdown);
    expect(vault.index.maps().map((map) => map.id)).toEqual(["a", "b"]);
    expect(vault.index.sources().some((source) => source.path === "a/Assets/uploaded.md")).toBe(false);
  });
  it("same owner is a no-op and stale ownership is rejected", async () => {
    const original = vault.resource;
    await vault.mover().move(original, vault.target("a", "one"));
    expect(vault.mutations).toEqual([]);
    await vault.mover().move(original, vault.target("a", "two"));
    await expect(vault.mover().move(original, vault.target("b", "one"))).rejects.toThrow(/ownership|moved/);
  });
  it("does not overwrite a concurrent native editor change", async () => {
    const changed = (await vault.read(vault.resource.path)) + "\nNew editor text\n";
    vault.beforeProcess = async () => { await writeFile(vault.path(vault.resource.path), changed); };
    await vault.mover().move(vault.resource, vault.target("a", "two"));
    expect(frontmatter(await vault.read(vault.resource.path)).body).toBe(frontmatter(changed).body);
  });
  it("keeps concurrent custom properties and rejects concurrent ownership changes", async () => {
    const original = vault.resource;
    const doc = frontmatter(await vault.read(original.path));
    doc.properties.tags = ["new tag"];
    vault.beforeProcess = async () => { await writeFile(vault.path(original.path), note(doc.properties, doc.body)); };
    await vault.mover().move(original, vault.target("a", "two"));
    expect(frontmatter(await vault.read(original.path)).properties.tags).toEqual(["new tag"]);
    const current = vault.index.resourceCatalog().resources.find((item) => item.id === original.id)!;
    const edited = frontmatter(await vault.read(original.path));
    edited.properties["emberly-order"] = 42;
    const changed = note(edited.properties, edited.body);
    vault.beforeProcess = async () => { await writeFile(vault.path(original.path), changed); };
    await expect(vault.mover().move(current, vault.target("a", "one"))).rejects.toThrow("changed while Move");
    expect(await vault.read(original.path)).toBe(changed);
  });
  async function addAttachment(shared = false): Promise<Uint8Array> {
    const bytes = new Uint8Array([0, 255, 3, 0, 42]);
    await vault.addFile("a/Assets/Report.bin", bytes);
    const fm = frontmatter(await vault.read(vault.resource.path)).properties;
    Object.assign(fm, { "emberly-kind": "file", "emberly-asset": "Assets/Report.bin" });
    const content = note(fm, "# Guide\n\n[Report](<../Assets/Report.bin>)\n\nKeep this.\n");
    await writeFile(vault.path(vault.resource.path), content); vault.index.setContent(vault.resource.path, content);
    if (shared) await vault.addFile("a/Resources/Shared.md", note({ emberly: "resource", "emberly-format": 2, "emberly-id": "shared", "emberly-map": "a", "emberly-topic": "a-one", "emberly-order": 2, "emberly-kind": "file", "emberly-asset": "Assets/Report.bin" }, "# Shared\n"));
    return bytes;
  }
  it("copies arbitrary bytes, resolves filename collisions and trashes only verified unused originals", async () => {
    const bytes = await addAttachment();
    await vault.addFile("b/Assets/Report.bin", new Uint8Array([99]));
    await vault.addFile("b/Resources/Guide.md", "# Existing ordinary note\n");
    vault.mutations.length = 0;
    const result = await vault.mover().move(vault.resource, vault.target("b", "two"));
    expect(result.path).toBe("b/Resources/Guide (2).md"); expect(result.kept).toEqual([]);
    expect([...await readFile(vault.path("b/Assets/Report (2).bin"))]).toEqual([...bytes]);
    expect([...await readFile(vault.path("b/Assets/Report.bin"))]).toEqual([99]);
    expect(await vault.read(result.path)).toContain("[[b/Assets/Report (2).bin|Report]]");
    expect(frontmatter(await vault.read(result.path)).properties["emberly-id"]).toBe("resource");
    expect(frontmatter(await vault.read(result.path)).properties["emberly-topic-link"]).toBe("[[../Topics/two]]");
    expect(vault.files.has("a/Assets/Report.bin")).toBe(false);
    expect([...await readFile(vault.path(".trash/a/Assets/Report.bin"))]).toEqual([...bytes]);
    expect(vault.pending).toBeNull();
    expect(vault.mutations.some((path) => /write:.*(?:Topics|Map\.md)/.test(path))).toBe(false);
  });
  it("retains shared assets, including frontmatter-only references", async () => {
    await addAttachment(true);
    const result = await vault.mover().move(vault.resource, vault.target("b", "one"));
    expect(result.kept).toEqual(["a/Assets/Report.bin"]); expect(vault.files.has("a/Assets/Report.bin")).toBe(true);
  });
  it("recovers after ownership commit but before rename without making duplicate notes", async () => {
    await addAttachment(); vault.failRename = true;
    await expect(vault.mover().move(vault.resource, vault.target("b", "one"))).rejects.toThrow("interruption");
    expect(vault.pending).not.toBeNull(); expect(vault.files.has("a/Assets/Report.bin")).toBe(true);
    vault.failRename = false;
    const result = await vault.mover().recover(vault.pending);
    expect(result.path).toBe("b/Resources/Guide.md"); expect(vault.pending).toBeNull();
    expect(vault.index.resourceCatalog().resources.filter((resource) => resource.id === "resource")).toHaveLength(1);
  });
  it("recovers an interrupted copy before ownership changes", async () => {
    await addAttachment(); vault.failCreate = true;
    await expect(vault.mover().move(vault.resource, vault.target("b", "one"))).rejects.toThrow("disk full");
    expect(vault.resource.mapId).toBe("a"); expect(vault.pending).not.toBeNull();
    vault.failCreate = false;
    await vault.mover().recover(vault.pending);
    expect(vault.resource.mapId).toBe("b"); expect(vault.pending).toBeNull();
  });
  it("refuses corrupted copies during recovery and keeps originals", async () => {
    await addAttachment(); vault.failRename = true;
    await expect(vault.mover().move(vault.resource, vault.target("b", "one"))).rejects.toThrow();
    await writeFile(vault.path("b/Assets/Report.bin"), new Uint8Array([18])); vault.failRename = false;
    await expect(vault.mover().recover(vault.pending)).rejects.toThrow("verification failed");
    expect(vault.files.has("a/Assets/Report.bin")).toBe(true);
  });
  it("does not transfer a note with stale link positions or unresolved links", async () => {
    await addAttachment(); vault.staleCache = true;
    await expect(vault.mover().move(vault.resource, vault.target("b", "one"))).rejects.toThrow("link index");
    expect(vault.pending).toBeNull(); expect(vault.resource.mapId).toBe("a");
    vault.staleCache = false;
    const content = (await vault.read(vault.resource.path)) + "[[Missing]]\n";
    await writeFile(vault.path(vault.resource.path), content); vault.index.setContent(vault.resource.path, content);
    await expect(vault.mover().move(vault.resource, vault.target("b", "one"))).rejects.toThrow("Unresolved link");
  });
  it("does not commit an interrupted transfer when the original attachment changed", async () => {
    await addAttachment(); vault.failCreate = true;
    await expect(vault.mover().move(vault.resource, vault.target("b", "one"))).rejects.toThrow();
    await writeFile(vault.path("a/Assets/Report.bin"), new Uint8Array([50])); vault.failCreate = false;
    await expect(vault.mover().recover(vault.pending)).rejects.toThrow("Attachment changed");
    expect(vault.resource.mapId).toBe("a"); expect(vault.files.has("a/Assets/Report.bin")).toBe(true);
  });
  it("preserves newer resource edits instead of replaying a recovery snapshot", async () => {
    await addAttachment(); vault.failRename = true;
    await expect(vault.mover().move(vault.resource, vault.target("b", "one"))).rejects.toThrow();
    const content = (await vault.read("a/Resources/Guide.md")) + "\nNewer user text\n";
    await writeFile(vault.path("a/Resources/Guide.md"), content); vault.failRename = false;
    await expect(vault.mover().recover(vault.pending)).rejects.toThrow("edited or moved");
    expect(await vault.read("a/Resources/Guide.md")).toBe(content);
    expect(vault.files.has("a/Assets/Report.bin")).toBe(true);
  });
  it("keeps originals referenced by native Canvas data", async () => {
    await addAttachment();
    await vault.addFile("a/Board.canvas", JSON.stringify({ nodes: [{ type: "file", file: "a/Assets/Report.bin" }], edges: [] }));
    const result = await vault.mover().move(vault.resource, vault.target("b", "one"));
    expect(result.kept).toEqual(["a/Assets/Report.bin"]);
  });
  it("copies note-embedded files but preserves ordinary linked note references", async () => {
    await vault.addFile("a/Assets/picture.png", new Uint8Array([1, 2, 3]));
    const content = (await vault.read(vault.resource.path)) + "\n![[a/Assets/picture.png|200]]\n[[a/Topics/one.md|Topic]]\n";
    await writeFile(vault.path(vault.resource.path), content); vault.index.setContent(vault.resource.path, content);
    const result = await vault.mover().move(vault.resource, vault.target("b", "one"));
    const moved = await vault.read(result.path);
    expect(moved).toContain("![[b/Assets/picture.png|200]]"); expect(moved).toContain("[[a/Topics/one.md|Topic]]");
    expect(vault.files.has("a/Topics/one.md")).toBe(true);
  });
  it("validates recovery paths before any operation", async () => {
    const hash = await byteHash(new ArrayBuffer(0));
    expect(() => validateTransfer({ version: 1, id: "resource", source: "a/Resources/r.md", destination: "../../outside.md", sourceAssets: "a/Assets", destinationAssets: "b/Assets", before: "a", after: "b", copies: [{ from: "a/Assets/a", to: "b/Assets/a", hash }] })).toThrow();
    expect(vault.mutations).toEqual([]);
  });
});
