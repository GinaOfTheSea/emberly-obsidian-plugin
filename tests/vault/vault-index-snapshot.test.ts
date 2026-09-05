import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceFixture, note } from "../helpers/resource-fixture";

describe("synchronous vault snapshots", () => {
  let vault: ResourceFixture;
  beforeEach(async () => { vault = await ResourceFixture.create(); });
  afterEach(async () => { vi.restoreAllMocks(); await vault.dispose(); });
  it("enumerates the vault once across multiple pane/catalog reads", () => {
    const scan = vi.spyOn(vault.app.vault, "getMarkdownFiles");
    vault.index.withSnapshot(() => {
      vault.index.maps(); vault.index.resourcesForTopic("a/Topics/one.md");
      vault.index.resourcesForTopic("a/Topics/two.md"); vault.index.resourceCatalog();
    });
    expect(scan).toHaveBeenCalledTimes(1);
    vault.index.resourcesForTopic("a/Topics/one.md");
    expect(scan).toHaveBeenCalledTimes(2);
  });
  it("invalidates synchronous writes and discards snapshots even after exceptions", () => {
    const file = vault.index.file("a/Resources/Guide.md")!;
    expect(() => vault.index.withSnapshot(() => {
      expect(vault.index.resourcesForTopic("a/Topics/one.md").resources).toHaveLength(1);
      vault.index.setContent(file.path, note({ ...vault.index.propertiesFor(file), "emberly-topic": "a-two" }));
      expect(vault.index.resourcesForTopic("a/Topics/one.md").resources).toHaveLength(0);
      expect(vault.index.resourcesForTopic("a/Topics/two.md").resources).toHaveLength(1);
      throw new Error("interrupted");
    })).toThrow("interrupted");
    const scan = vi.spyOn(vault.app.vault, "getMarkdownFiles");
    vault.index.maps(); expect(scan).toHaveBeenCalledOnce();
  });
});
