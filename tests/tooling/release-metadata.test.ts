import { describe, expect, it } from "vitest";
// @ts-expect-error Node release scripts deliberately use plain JavaScript.
import { validateReleaseMetadata } from "../../scripts/release/release-metadata.mjs";

function fixture() {
  return {
    manifest: { id: "emberly-maps", name: "Emberly Maps", author: "Emberly AS", description: "Edit Markdown mind maps.",
      version: "0.1.0", minAppVersion: "1.13.7", isDesktopOnly: true },
    pkg: { name: "emberly-maps", version: "0.1.0" },
    lock: { version: "0.1.0", packages: { "": { version: "0.1.0" } } },
    versions: { "0.1.0": "1.13.7" },
  };
}

describe("Obsidian release metadata", () => {
  it("accepts synchronized versions and the exact release tag", () => {
    const { manifest, pkg, lock, versions } = fixture();
    expect(validateReleaseMetadata(manifest, pkg, lock, versions, "0.1.0")).toBe(manifest);
  });
  it.each(["v0.1.0", "0.1.1", "0.1.0-beta.1"])("rejects an incompatible tag %s", (tag) => {
    const { manifest, pkg, lock, versions } = fixture();
    expect(() => validateReleaseMetadata(manifest, pkg, lock, versions, tag)).toThrow("tag must be exactly");
  });
  it("rejects version drift and missing compatibility mappings", () => {
    const { manifest, pkg, lock, versions } = fixture();
    expect(() => validateReleaseMetadata(manifest, { ...pkg, version: "0.2.0" }, lock, versions)).toThrow("versions must match");
    expect(() => validateReleaseMetadata(manifest, pkg, lock, {})).toThrow("versions.json must map");
    expect(() => validateReleaseMetadata(manifest, pkg, { ...lock, version: "0.2.0" }, versions)).toThrow("versions must match");
  });
});
