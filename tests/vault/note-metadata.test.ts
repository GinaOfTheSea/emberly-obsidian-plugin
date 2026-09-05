import { describe, expect, it } from "vitest";
import { isMapNotePath, leanTopicProperties, mapNoteFilename, mapTitle, NoteIdAllocator, noteTitle, renamedMapPath, renamedNotePath } from "../../src/vault/note-metadata";

describe("lean note metadata", () => {
  it.each(["Map.md", "Topics/café 🌈.md", "Resources/Manual.pdf.md", "Resources/file.png (2).md"])("uses only the final Markdown extension in %s", (path) => {
    expect(noteTitle(path)).toBe(path.split("/").at(-1)!.slice(0, -3));
  });
  it("removes only redundant topic settings and preserves old dates/IDs/custom values", () => {
    const core = { emberly: "topic", "emberly-format": 2, "emberly-id": "old-uuid", "emberly-map": "map-uuid",
      created: "2001-02-03", modified: "2004-05-06", custom: { nested: true } };
    const fm = { ...core, "emberly-side": "right", "emberly-color": -1, "emberly-collapsed": false, "emberly-rating": 0, "emberly-state": 0 };
    expect(leanTopicProperties(fm)).toEqual(core);
    expect(fm).toHaveProperty("emberly-collapsed", false);
  });
  it("preserves explicit settings and nonzero state bits; root side is map-owned", () => {
    const fm = { emberly: "topic", "emberly-side": "left", "emberly-color": 0, "emberly-collapsed": true, "emberly-rating": 4, "emberly-state": 9 };
    expect(leanTopicProperties(fm)).toEqual(fm);
    expect(leanTopicProperties(fm, true)).toEqual({ emberly: "topic", "emberly-color": 0, "emberly-collapsed": true, "emberly-rating": 4, "emberly-state": 9 });
  });
  it("doesn't reinterpret malformed values or non-topic properties", () => {
    const fm = { emberly: "topic", "emberly-color": "-1", "emberly-collapsed": "false", "emberly-state": null };
    expect(leanTopicProperties(fm)).toEqual(fm);
    expect(leanTopicProperties({ ...fm, emberly: "resource" })).toEqual({ ...fm, emberly: "resource" });
  });
  it.each(["", "../topic", "a/b", "a\\b", "x:y", "a#h", "a^b", "trailing.", " spaced", "NUL", "COM1.txt"])("rejects unsafe rename %j", (name) => {
    expect(() => renamedNotePath("Map/Topics/Old.md", name)).toThrow();
  });
  it("renames only the note, retaining its folder and attachment extension", () => {
    expect(renamedNotePath("Map/Resources/old.md", "Manual.pdf")).toBe("Map/Resources/Manual.pdf.md");
  });
  it("uses a recognizable compound suffix for map notes without exposing it as the map title", () => {
    expect(mapNoteFilename("Sailing")).toBe("Sailing.emberly.md");
    expect(mapTitle("Maps/Sailing/Sailing.emberly.md")).toBe("Sailing");
    expect(mapTitle("Maps/Existing/Existing.md")).toBe("Existing");
    expect(noteTitle("Topics/Keep.emberly.md")).toBe("Keep.emberly");
    expect(renamedMapPath("Maps/Old/Old.md", "New map")).toBe("Maps/Old/New map.emberly.md");
    expect(isMapNotePath("Maps/Sailing/Sailing.emberly.md")).toBe(true);
    expect(isMapNotePath("Maps/Sailing/Sailing.md")).toBe(false);
    expect(isMapNotePath("Maps/Sailing/Topics/emberly.md")).toBe(false);
  });
});

describe("80-bit Crockford IDs", () => {
  it("uses secure random values by default and emits the 16-character lowercase alphabet", () => {
    const allocator = new NoteIdAllocator(() => ["ba0c0bb4-1b64-4250-81a6-0c5b2e1da090"]);
    const ids = Array.from({ length: 200 }, () => allocator.allocate());
    expect(new Set(ids).size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{16}$/);
  });
  it("maps every byte uniformly onto its 32-character alphabet", () => {
    let at = 0;
    const allocator = new NoteIdAllocator(() => [], (bytes) => bytes.fill(at++));
    const first = allocator.allocate();
    expect(first).toBe("0".repeat(16));
    expect(allocator.allocate()).toBe("1".repeat(16));
    // Values differing by 32 collide and retry rather than biasing a character.
    at = 32;
    expect(allocator.allocate()).toBe("2".repeat(16));
  });
  it("retries existing IDs and reserves concurrent creations before metadata catches up", async () => {
    const existing = ["0".repeat(16), "legacy-uuid"];
    let at = 0;
    const allocator = new NoteIdAllocator(() => existing, (bytes) => bytes.fill(at++));
    expect(allocator.allocate()).toBe("1".repeat(16));
    at = 1;
    const ids = await Promise.all([0, 1, 2].map(async () => allocator.allocate()));
    expect(ids).toEqual(["2".repeat(16), "3".repeat(16), "4".repeat(16)]);
    expect(existing).toEqual(["0".repeat(16), "legacy-uuid"]);
  });
  it("stops safely if the randomness source keeps colliding", () => {
    expect(() => new NoteIdAllocator(() => ["0".repeat(16)], (bytes) => bytes.fill(0)).allocate()).toThrow("unique");
  });
});
