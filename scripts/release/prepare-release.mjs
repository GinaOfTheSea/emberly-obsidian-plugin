import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readReleaseMetadata, checkReleaseAssets } from "./release-metadata.mjs";

const manifest = readReleaseMetadata(process.cwd(), process.env.RELEASE_TAG);
checkReleaseAssets();
const destination = join("dist", manifest.version);
mkdirSync(destination, { recursive: true });
const files = ["main.js", "manifest.json", "styles.css", "LICENSE", "THIRD_PARTY_NOTICES.md"];
const checksums = [];
for (const file of files) {
  copyFileSync(file, join(destination, file));
  checksums.push(`${createHash("sha256").update(readFileSync(join(destination, file))).digest("hex")}  ${file}`);
}
writeFileSync(join(destination, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
console.log(`Release files prepared in ${destination}. Upload main.js, manifest.json and styles.css individually.`);
