import { readFileSync, writeFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(name, "utf8"));
const write = (name, value) => writeFileSync(name, JSON.stringify(value, null, 2) + "\n");
const pkg = read("package.json");
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) {
  throw new Error("Obsidian release versions must be x.y.z without prerelease suffixes.");
}
const manifest = read("manifest.json");
const versions = read("versions.json");
manifest.version = pkg.version;
if (versions[pkg.version] && versions[pkg.version] !== manifest.minAppVersion) {
  throw new Error("Do not rewrite an existing release's compatibility mapping. Use a new version.");
}
versions[pkg.version] = manifest.minAppVersion;
write("manifest.json", manifest);
write("versions.json", versions);
