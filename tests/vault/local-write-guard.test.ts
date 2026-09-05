import { describe, expect, it } from "vitest";
import { LocalWriteGuard } from "../../src/vault/local-write-guard";

describe("LocalWriteGuard", () => {
  it("does not suppress an external edit during an expected local write", () => {
    const guard = new LocalWriteGuard();
    guard.expect("map.md", "local change");
    expect(guard.matches("map.md", "local change")).toBe(true);
    expect(guard.matches("map.md", "external change")).toBe(false);
  });
  it("never treats a timing-only mark as proof of a local write", () => {
    const guard = new LocalWriteGuard();
    guard.mark("topic.md");
    expect(guard.matches("topic.md", "external edit")).toBe(false);
  });
  it("compares nested properties regardless of YAML key order", () => {
    const guard = new LocalWriteGuard();
    guard.expectProperties("topic.md", { parent: "a", custom: { one: 1, two: [2, 3] } });
    expect(guard.matches("topic.md", "body", { custom: { two: [2, 3], one: 1 }, parent: "a" })).toBe(true);
    expect(guard.matches("topic.md", "body", { parent: "b", custom: { one: 1, two: [2, 3] } })).toBe(false);
    guard.forget("topic.md");
    expect(guard.matches("topic.md", "body", { parent: "a", custom: { one: 1, two: [2, 3] } })).toBe(false);
  });
  it("suppresses every metadata event throughout the local-write window", () => {
    const guard = new LocalWriteGuard(2_000);
    guard.mark("topic.md", 1_000);

    expect(guard.has("topic.md", 1_100)).toBe(true);
    expect(guard.has("topic.md", 1_200)).toBe(true);
    expect(guard.has("topic.md", 2_999)).toBe(true);
    expect(guard.has("topic.md", 3_000)).toBe(false);
  });

  it("keeps a newer write guarded and prunes expired paths", () => {
    const guard = new LocalWriteGuard(2_000);
    guard.mark("first.md", 1_000);
    guard.mark("topic.md", 1_500);
    guard.mark("topic.md", 2_500);
    guard.mark("latest.md", 3_100);

    expect(guard.has("first.md", 3_100)).toBe(false);
    expect(guard.has("topic.md", 4_499)).toBe(true);
    expect(guard.has("topic.md", 4_500)).toBe(false);
    expect(guard.has("latest.md", 4_500)).toBe(true);
  });
});
