import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

export function validateReleaseMetadata(manifest, pkg, lock, versions, tag) {
  ensure(typeof manifest.id === "string" && /^[a-z]+(?:-[a-z]+)*$/.test(manifest.id)
    && !manifest.id.includes("obsidian") && !manifest.id.endsWith("plugin"), "Invalid Obsidian plugin ID.");
  for (const key of ["name", "author", "description"]) ensure(typeof manifest[key] === "string" && manifest[key].trim(), `Missing manifest ${key}.`);
  ensure(manifest.description.length <= 250 && manifest.description.endsWith("."), "Use a description of at most 250 characters ending with a period.");
  ensure(versionPattern.test(manifest.version), "Obsidian versions must be x.y.z without a v prefix or prerelease suffix.");
  ensure(versionPattern.test(manifest.minAppVersion), "Invalid minimum Obsidian version.");
  ensure(typeof manifest.isDesktopOnly === "boolean", "Declare desktop compatibility explicitly.");
  ensure(pkg.name === manifest.id, "Package name and manifest ID must match.");
  ensure(pkg.version === manifest.version && lock.version === manifest.version
    && lock.packages?.[""]?.version === manifest.version, "Package, lockfile and manifest versions must match.");
  ensure(versions[manifest.version] === manifest.minAppVersion, "versions.json must map this release to minAppVersion.");
  for (const [version, minimum] of Object.entries(versions)) {
    ensure(versionPattern.test(version) && versionPattern.test(minimum), "versions.json contains an invalid version.");
  }
  if (tag !== undefined) ensure(tag === manifest.version, `Release tag must be exactly ${manifest.version}.`);
  return manifest;
}

export function readReleaseMetadata(root = process.cwd(), tag) {
  const json = (name) => JSON.parse(readFileSync(resolve(root, name), "utf8"));
  return validateReleaseMetadata(json("manifest.json"), json("package.json"), json("package-lock.json"), json("versions.json"), tag);
}

export function checkReleaseAssets(root = process.cwd()) {
  for (const name of ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    ensure(statSync(resolve(root, name)).size > 0, `Missing or empty release file: ${name}`);
  }
  ensure(!/\/\/# sourceMappingURL=/m.test(readFileSync(resolve(root, "main.js"), "utf8")), "Release main.js must be a production build without a source map.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = readReleaseMetadata(process.cwd(), process.env.RELEASE_TAG);
  if (process.argv.includes("--assets")) checkReleaseAssets();
  console.log(`Release metadata valid: ${manifest.id} ${manifest.version} (Obsidian ${manifest.minAppVersion}+)`);
}
