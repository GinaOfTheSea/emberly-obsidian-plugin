import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { MapFileOperations } from "../../src/maps/map-file-operations";
import { frontmatter } from "../../src/vault/vault-files";
import { ResourceFixture } from "../helpers/resource-fixture";

describe("map duplication and trash through public vault APIs", () => {
  let vault: ResourceFixture, operations: MapFileOperations;
  beforeEach(async () => {
    vault = await ResourceFixture.create();
    operations = new MapFileOperations(vault.app, vault.index, () => {});
  });
  afterEach(async () => { vi.restoreAllMocks(); await vault.dispose(); });
  const writeNote = async (path: string, content: string) => {
    const file = await vault.app.vault.create(path, content); vault.index.setContent(path, content); return file;
  };
  const edit = async (path: string, properties: Record<string, unknown>, body?: string) => {
    const file = vault.index.file(path)!;
    await vault.app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, properties));
    if (body !== undefined) {
      await vault.app.vault.process(file, (content) => content.slice(0, content.length - frontmatter(content).body.length) + body);
    }
    vault.index.setContent(path, await vault.read(path));
  };
  it("copies identities, hierarchy, center media, resource ownership and links without changing originals", async () => {
    const bytes = new Uint8Array([0, 1, 255, 42]);
    await vault.addFile("a/Assets/photo.png", bytes);
    await vault.addFile("Outside.md", "External note");
    await edit("a/Map.md", { "emberly-center": "image", "emberly-center-image": "[[a/Assets/photo.png]]" });
    await edit("a/Resources/Guide.md", { "emberly-kind": "image", "emberly-asset": "Assets/photo.png" }, "![[a/Assets/photo.png]]\n[[a/Topics/two#Heading|Topic]]\n[[Outside]]\n");
    const snapshot = await operations.snapshot("a", true);
    const path = await operations.duplicate(snapshot, writeNote);
    const copy = vault.index.mapByPath(path)!;
    expect(copy.issues).toEqual([]); expect(copy.id).not.toBe("a");
    const originals = new Set(snapshot.map.nodes.map((node) => node.id));
    expect(copy.nodes.every((node) => !originals.has(node.id))).toBe(true);
    const one = copy.nodes.find((node) => node.title === "one")!, two = copy.nodes.find((node) => node.title === "two")!;
    expect(two.parentId).toBe(one.id); expect(two.order).toBe("a0");
    const resource = vault.index.resourceCatalog().resources.find((resource) => resource.mapId === copy.id)!;
    expect(resource.id).not.toBe("resource"); expect(resource.topicId).toBe(one.id);
    const content = await vault.read(resource.path);
    expect(content).toContain(`[[${two.path}#Heading|Topic]]`);
    expect(content).toContain("[[Outside.md]]");
    expect(content).toContain(`[[${one.path}]]`);
    expect(await readFile(vault.path(`${copy.folder}/Assets/photo.png`))).toEqual(Buffer.from(bytes));
    expect(frontmatter(await vault.read(path)).properties["emberly-center-image"]).toBe(`[[${copy.folder}/Assets/photo.png]]`);
    for (const note of snapshot.notes) expect(await vault.read(note.path)).toBe(note.content);
  });
  it("reserves distinct destinations for simultaneous copies", async () => {
    const snapshot = await operations.snapshot("a", true);
    const outcomes = await Promise.allSettled([operations.duplicate(snapshot, writeNote), operations.duplicate(snapshot, writeNote)]);
    const copies = outcomes.map((outcome) => { if (outcome.status === "rejected") throw outcome.reason; return outcome.value; });
    expect(new Set(copies).size).toBe(2);
    expect(new Set(copies.map((path) => vault.index.mapByPath(path)!.id)).size).toBe(2);
  });
  it("rejects stale notes and unresolved links before copying", async () => {
    const snapshot = await operations.snapshot("a", true);
    await writeFile(vault.path("a/Topics/two.md"), snapshot.notes.find((note) => note.path === "a/Topics/two.md")!.content + "External edit");
    await expect(operations.duplicate(snapshot, writeNote)).rejects.toThrow("changed");
    await edit("a/Resources/Guide.md", {}, "[[Missing note]]");
    await expect(operations.snapshot("a", true)).rejects.toThrow("Resolve");
    expect(vault.index.maps()).toHaveLength(2);
  });
  it("keeps partial copy files and publishes no map when a write fails", async () => {
    const snapshot = await operations.snapshot("a", true); let writes = 0;
    await expect(operations.duplicate(snapshot, async (path, content) => {
      if (++writes === 2) throw new Error("disk full");
      return writeNote(path, content);
    })).rejects.toThrow("Partial copy files are kept");
    expect(vault.app.vault.getMarkdownFiles().some((file) => file.path.startsWith("Emberly Maps/Copy of Map/"))).toBe(true);
    expect(vault.index.maps()).toHaveLength(2);
    for (const note of snapshot.notes) expect(await vault.read(note.path)).toBe(note.content);
  });
  it("trashes owned notes and unshared assets while keeping shared, external and unrelated files", async () => {
    await vault.addFile("a/Assets/solo.bin", new Uint8Array([1]));
    await vault.addFile("a/Assets/shared.bin", new Uint8Array([2]));
    await vault.addFile("External.bin", new Uint8Array([3]));
    await vault.addFile("a/Assets/unrelated.bin", new Uint8Array([4]));
    await vault.addFile("Outside.md", "[[a/Assets/shared.bin]]");
    await edit("a/Resources/Guide.md", {}, "[[a/Assets/solo.bin]] [[a/Assets/shared.bin]] [[External.bin]]");
    const snapshot = await operations.snapshot("a");
    const close = vi.fn(); const result = await operations.trash(snapshot, close);
    expect(close).toHaveBeenCalledOnce(); expect(result).toEqual({ notes: 4, assets: 1, kept: 2 });
    expect(vault.index.file("a/Assets/solo.bin")).toBeUndefined();
    for (const path of ["a/Assets/shared.bin", "External.bin", "a/Assets/unrelated.bin", "Outside.md"]) expect(vault.index.file(path)).toBeDefined();
    expect(vault.index.maps().map((map) => map.id)).toEqual(["b"]);
  });
  it("rejects stale deletion snapshots without trashing anything", async () => {
    const snapshot = await operations.snapshot("a");
    await edit("a/Topics/two.md", { "emberly-rating": 5 });
    await expect(operations.trash(snapshot, vi.fn())).rejects.toThrow("changed");
    expect(vault.mutations.some((action) => action.startsWith("trash:"))).toBe(false);
  });
  it("reports partial trash failures and leaves remaining notes available for recovery", async () => {
    const snapshot = await operations.snapshot("a");
    const trash = vault.app.fileManager.trashFile.bind(vault.app.fileManager); let count = 0;
    vi.spyOn(vault.app.fileManager, "trashFile").mockImplementation(async (file) => {
      if (++count === 2) throw new Error("trash unavailable"); await trash(file);
    });
    await expect(operations.trash(snapshot, vi.fn())).rejects.toThrow("Moved 1 notes and 0 attachments");
    expect(vault.index.file("a/Map.md")).toBeDefined();
    expect(vault.mutations.filter((action) => action.startsWith("trash:"))).toHaveLength(1);
  });
});
