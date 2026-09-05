import { stringifyYaml, type App, type TFile } from "obsidian";
import { nextResourceOrder } from "./resource-catalog";
import type { EmberlyVaultIndex } from "../vault/vault-index";
import { resourceWebUrl } from "./resource-properties";
import { RESOURCE_TOPIC_LINK_PROPERTY, resourceTopicLink } from "./resource-topic-link";
import { frontmatter, safeName, fileNameParts, ensureFolder, createUnique } from "../vault/vault-files";

export const MAX_RESOURCE_BATCH_BYTES = 100 * 1024 * 1024;
export interface ResourceTarget { file: TFile; id: string; mapId: string; }
export type ResourceDraft = { kind: "link"; url: string; title?: string }
  | { kind: "offline"; files: File[]; title?: string; source?: string; description?: string };
export interface ResourceCreateResult { added: number; paths: string[]; errors: string[]; }

export function resourceFileError(files: File[]): string | undefined {
  if (files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) > MAX_RESOURCE_BATCH_BYTES) {
    return "Choose up to 20 files and at most 100 MiB in total.";
  }
  return undefined;
}

function topicDocument(content: string, target: ResourceTarget): ReturnType<typeof frontmatter> {
  const doc = frontmatter(content), properties = doc.properties;
  if (properties.emberly !== "topic" || properties["emberly-format"] !== 2 || properties["emberly-id"] !== target.id || properties["emberly-map"] !== target.mapId) {
    throw new Error("The destination topic changed. Choose the topic again.");
  }
  if (typeof properties["emberly-parent"] !== "string" || !properties["emberly-parent"].trim()) {
    throw new Error("The map root cannot own resources. Choose a non-root topic.");
  }
  return doc;
}

/** Sniff only to choose a preview, never to reject other attachment types. */
export async function imageExtension(file: File): Promise<string | undefined> {
  const bytes = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const matches = (offset: number, values: number[]): boolean => values.every((value, i) => bytes[offset + i] === value);
  const ascii = (offset: number, value: string): boolean => matches(offset, [...value].map((char) => char.charCodeAt(0)));
  if (matches(0, [137, 80, 78, 71, 13, 10, 26, 10])) return "png";
  if (matches(0, [255, 216, 255])) return "jpg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  if (bytes.length >= 16 && ascii(4, "ftyp")) {
    const boxSize = new DataView(bytes.buffer).getUint32(0);
    for (let offset = 8; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
      if (offset !== 12 && (ascii(offset, "avif") || ascii(offset, "avis"))) return "avif";
    }
  }
  return undefined;
}

/** Caller serializes this operation with the map's other Markdown writes. */
export async function createResources(app: App, index: EmberlyVaultIndex, target: ResourceTarget, draft: ResourceDraft, expectWrite: (path: string, content: string) => void): Promise<ResourceCreateResult> {
  const url = draft.kind === "link" ? resourceWebUrl(draft.url) : undefined;
  if (draft.kind === "link" && !url) throw new Error("Enter a valid http or https web link.");
  const titleInput = draft.title?.trim().replace(/[\r\n]+/g, " ") ?? "";
  const files = draft.kind === "offline" ? [...draft.files] : [];
  const fileError = resourceFileError(files);
  if (fileError) throw new Error(fileError);
  if (draft.kind === "offline" && !files.length && !titleInput) throw new Error("Give the offline resource a name, or attach a file.");
  const maps = index.maps().filter((map) => map.id === target.mapId);
  const map = maps[0];
  if (maps.length !== 1 || !map || map.format !== 2 || map.issues.length || !map.nodes.some((node) => node.id === target.id && node.path === target.file.path)) {
    throw new Error("The topic's map is missing or has hierarchy issues. Repair it before adding resources.");
  }
  if (!map.nodes.find((node) => node.id === target.id)!.parentId) throw new Error("The map root cannot own resources. Choose a non-root topic.");
  const mapFile = index.file(map.path);
  if (!mapFile) throw new Error("The map note is missing.");
  const mapPath = mapFile.path, folder = mapPath.split("/").slice(0, -1).join("/");
  const assetsFolder = [folder, "Assets"].filter(Boolean).join("/");
  const resourcesFolder = [folder, "Resources"].filter(Boolean).join("/");
  const assertFiles = (): void => {
    if (mapFile.path !== mapPath || index.file(mapPath) !== mapFile || index.file(target.file.path) !== target.file) {
      throw new Error("The map moved or a destination note was removed. Try again from its new location.");
    }
  };
  const assertDestination = async (): Promise<void> => {
    assertFiles();
    const mapDoc = frontmatter(await app.vault.read(mapFile));
    if (mapDoc.properties["emberly-root-id"] === target.id) throw new Error("The map root cannot own resources. Choose a non-root topic.");
    if (mapDoc.properties.emberly !== "map" || mapDoc.properties["emberly-format"] !== 2 || mapDoc.properties["emberly-id"] !== target.mapId
      || mapDoc.properties["emberly-root-id"] !== map.nodes.find((node) => !node.parentId)?.id) {
      throw new Error("The map or its topic membership changed while adding the resource.");
    }
    assertFiles();
  };
  await assertDestination();
  topicDocument(await app.vault.read(target.file), target);
  const result: ResourceCreateResult = { added: 0, paths: [], errors: [] };
  for (const file of files.length ? files : [undefined]) {
    const created: TFile[] = [];
    try {
      await assertDestination();
      topicDocument(await app.vault.read(target.file), target);
      let asset: TFile | undefined;
      let kind = draft.kind === "link" ? "link" : "note";
      if (file) {
        const { stem, extension } = fileNameParts(file.name);
        const detected = await imageExtension(file);
        const actualExtension = extension.toLowerCase().replace(/^jpeg$/, "jpg");
        kind = detected && actualExtension === detected ? "image" : "file";
        await ensureFolder(app, assetsFolder);
        const data = await file.arrayBuffer();
        assertFiles();
        asset = await createUnique(app, assetsFolder, stem, extension, (path) => app.vault.createBinary(path, data));
        created.push(asset);
      }
      await ensureFolder(app, resourcesFolder);
      const id = index.allocateId();
      const title = (files.length <= 1 ? titleInput : "") || asset?.name || (url ? new URL(url).hostname : "Resource");
      const properties = {
        emberly: "resource", "emberly-format": 2, "emberly-id": id, "emberly-map": target.mapId,
        "emberly-topic": target.id, "emberly-kind": kind, "emberly-order": nextResourceOrder(index.resourceCatalog().resources, target.mapId, target.id),
        ...(asset ? { "emberly-asset": asset.path.slice(folder ? folder.length + 1 : 0) } : {}),
        ...(url ? { url } : {}),
        ...(draft.kind === "offline" && draft.source?.trim() ? { source: draft.source.trim() } : {}),
        ...(draft.kind === "offline" && draft.description?.trim() ? { description: draft.description.trim() } : {}),
      };
      assertFiles();
      await assertDestination();
      topicDocument(await app.vault.read(target.file), target);
      const resource = await createUnique(app, resourcesFolder, safeName(title), "md", async (path) => {
        // The Emberly resource header already renders the filename, primary
        // attachment/link, rating and tags. Keep the native editor available
        // exclusively for notes the user chooses to add.
        const content = `---\n${stringifyYaml({
          ...properties,
          [RESOURCE_TOPIC_LINK_PROPERTY]: resourceTopicLink(app.metadataCache, path, target.file),
        }).trimEnd()}\n---\n`;
        expectWrite(path, content);
        const file = await app.vault.create(path, content);
        index.setContent(file.path, content);
        return file;
      });
      created.push(resource);
      result.added++;
      result.paths.push(resource.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${file?.name || titleInput || url || "Resource"}: ${message}${created.length ? ` Saved files were kept for recovery: ${created.map((file) => file.path).join(", ")}.` : ""}`);
    }
  }
  return result;
}
