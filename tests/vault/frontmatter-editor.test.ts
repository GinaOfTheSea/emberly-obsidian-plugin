import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrontmatterEditor } from "../../src/vault/frontmatter-editor";
import { LocalWriteGuard } from "../../src/vault/local-write-guard";
import { frontmatter } from "../../src/vault/vault-files";
import { ResourceFixture, note } from "../helpers/resource-fixture";

describe("frontmatter write event attribution", () => {
  let vault: ResourceFixture;
  beforeEach(async () => { vault = await ResourceFixture.create(); });
  afterEach(async () => { vi.restoreAllMocks(); await vault.dispose(); });
  it("recognizes the intended properties before completion but never claims an intervening hierarchy edit", async () => {
    const guard = new LocalWriteGuard(), editor = new FrontmatterEditor(vault.app, () => vault.index, guard);
    const file = vault.index.file("a/Topics/two.md")!;
    const process = vault.app.fileManager.processFrontMatter.bind(vault.app.fileManager);
    vi.spyOn(vault.app.fileManager, "processFrontMatter").mockImplementation(async (target, callback) => {
      await process(target, callback);
      const saved = frontmatter(await vault.read(target.path)).properties;
      expect(guard.matches(target.path, note(saved), saved)).toBe(true);
      await process(target, (properties) => { properties["emberly-parent"] = "a-root"; });
      const external = frontmatter(await vault.read(target.path)).properties;
      expect(guard.matches(target.path, note(external), external)).toBe(false);
    });
    await editor.update(file, { "emberly-rating": 3 });
    const content = await vault.read(file.path), properties = frontmatter(content).properties;
    expect(properties).toMatchObject({ "emberly-parent": "a-root", "emberly-rating": 3 });
    expect(guard.matches(file.path, content, properties)).toBe(false);
  });
  it("forgets attribution when a frontmatter write fails", async () => {
    const guard = new LocalWriteGuard(), editor = new FrontmatterEditor(vault.app, () => vault.index, guard);
    const file = vault.index.file("a/Topics/two.md")!;
    vi.spyOn(vault.app.fileManager, "processFrontMatter").mockImplementation(async (_file, callback) => {
      callback({ ...vault.index.propertiesFor(file) }); throw new Error("disk full");
    });
    await expect(editor.update(file, { "emberly-rating": 3 })).rejects.toThrow("disk full");
    expect(guard.has(file.path)).toBe(false);
  });
});
