import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphLinkCoordinator } from "../../src/vault/graph-link-coordinator";
import { FrontmatterEditor } from "../../src/vault/frontmatter-editor";
import { LocalWriteGuard } from "../../src/vault/local-write-guard";
import { ResourceFixture } from "../helpers/resource-fixture";

describe("graph link scheduling", () => {
  let vault: ResourceFixture, coordinator: GraphLinkCoordinator;
  const pending: Promise<void>[] = [];
  beforeEach(async () => {
    vault = await ResourceFixture.create();
    vi.useFakeTimers(); vi.stubGlobal("window", globalThis);
    const editor = new FrontmatterEditor(vault.app, () => vault.index, new LocalWriteGuard());
    coordinator = new GraphLinkCoordinator({ app: vault.app, vaultIndex: () => vault.index, stopped: () => false,
      queueMapWrite: (_id, action) => { const result = action(); pending.push(result); return result; },
      updateProperties: (file, update) => editor.update(file, update) });
  });
  afterEach(async () => {
    coordinator.dispose(); await Promise.all(pending.splice(0));
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); await vault.dispose();
  });
  it("repairs graph links after a native rename with automatic link updates disabled", async () => {
    const parent = vault.index.file("a/Topics/one.md")!;
    await vault.app.fileManager.renameFile(parent, "a/Topics/Renamed.md");
    coordinator.schedule();
    await vi.advanceTimersByTimeAsync(200); await Promise.all(pending);
    expect(vault.index.propertiesFor(vault.index.file("a/Topics/two.md")!)["emberly-parent-link"]).toBe("[[Renamed]]");
    expect(vault.index.propertiesFor(vault.index.file("a/Resources/Guide.md")!)["emberly-topic-link"]).toBe("[[../Topics/Renamed]]");
  });
  it("coalesces explicit IDs, ignores empty IDs, and cancels queued work on disposal", async () => {
    const reconcile = vi.spyOn(coordinator, "reconcile").mockResolvedValue();
    coordinator.schedule(["", "a", "a"]); coordinator.schedule(["a"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(reconcile.mock.calls).toEqual([["a"]]);
    coordinator.schedule([]); await vi.advanceTimersByTimeAsync(200);
    expect(reconcile).toHaveBeenCalledTimes(1);
    coordinator.schedule(); coordinator.dispose(); await vi.advanceTimersByTimeAsync(200);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
