import { parseLinktext, type App, type CachedMetadata, type TFile } from "obsidian";
import type { EmberlyMap } from "../shared/types";
import type { EmberlyVaultIndex } from "../vault/vault-index";
import { createUnique, ensureFolder, fileNameParts, frontmatter, relativeLink, safeName, serializeNote } from "../vault/vault-files";
import { byteHash, safeVaultPath } from "../resources/resource-transfer";
import { mapNoteFilename } from "../vault/note-metadata";
import { hasSpecialLinkCharacter } from "../shared/text-validation";

type Document = ReturnType<typeof frontmatter>;
interface NoteSnapshot {
  file: TFile; path: string; content: string; doc: Document; cache?: CachedMetadata;
  links: Map<string, { file: TFile; path: string }>;
  primaryAsset?: string;
}
interface AssetSnapshot { file: TFile; path: string; mtime: number; size: number; }
export interface MapFileSnapshot { map: EmberlyMap; notes: NoteSnapshot[]; assets: AssetSnapshot[]; }

const parent = (path: string) => path.split("/").slice(0, -1).join("/");
const join = (folder: string, name: string) => folder ? `${folder}/${name}` : name;
const remote = (link: string) => /^[a-z][a-z0-9+.-]*:/i.test(link) && !/^file:/i.test(link);

/** Obsidian can leave safe filename punctuation percent-encoded in cached links. */
function linkPathCandidates(path: string): string[] {
  const candidates = [path];
  try {
    const decoded = decodeURIComponent(path);
    if (decoded !== path) candidates.push(decoded);
  } catch { /* A literal or malformed percent sign may still resolve as written. */ }
  return candidates;
}

/** Explicit ownership snapshots; never infer which notes to copy/trash from folders. */
export class MapFileOperations {
  constructor(private readonly app: App, private readonly index: EmberlyVaultIndex, private readonly assertActive: () => void) {}

  private ownedFiles(mapId: string): { map: EmberlyMap; files: TFile[] } {
    this.assertActive();
    const maps = this.index.maps().filter((map) => map.id === mapId), map = maps[0];
    if (maps.length !== 1 || !map || map.format !== 2 || map.issues.length || !this.index.hierarchySettled(mapId)) {
      throw new Error("Wait for indexing and resolve the map's hierarchy issues before duplicating or deleting it.");
    }
    const catalog = this.index.resourceCatalog();
    if (catalog.issues.some((issue) => issue.mapId === mapId)) throw new Error("Resolve this map's resource ownership issues first. No files were changed.");
    const paths = [...new Set([map.path, ...map.nodes.map((node) => node.path), ...catalog.resources.filter((resource) => resource.mapId === mapId).map((resource) => resource.path)])];
    const files = paths.map((path) => {
      if (!safeVaultPath(path)) throw new Error("A map note has an unsafe vault path.");
      const file = this.index.file(path);
      if (!file) throw new Error(`Missing map note: ${path}`);
      return file;
    });
    return { map, files };
  }

  async snapshot(mapId: string, forCopy = false): Promise<MapFileSnapshot> {
    const { map, files } = this.ownedFiles(mapId);
    const notes: NoteSnapshot[] = [], assets = new Map<string, AssetSnapshot>();
    const addAsset = (file: TFile) => {
      if (!assets.has(file.path)) assets.set(file.path, { file, path: file.path, mtime: file.stat.mtime, size: file.stat.size });
    };
    for (const file of files) {
      this.assertActive();
      const path = file.path, content = await this.app.vault.read(file), doc = frontmatter(content);
      // Cached frontmatter may include Obsidian's own position field. Compare
      // ownership/structure, not that derived cache data.
      const cached = this.index.propertiesFor(file);
      for (const key of ["emberly", "emberly-format", "emberly-id", "emberly-map", "emberly-parent", "emberly-topic", "emberly-root-id", "emberly-order", "emberly-layout"]) {
        if (file.path !== path || doc.properties[key] !== cached[key]) throw new Error("Map ownership changed during preparation. Try again once indexing finishes.");
      }
      const cache = this.app.metadataCache.getFileCache(file) ?? undefined;
      if (forCopy && (!cache || !this.index.referenceCacheCurrent(path, content) || cache.referenceLinks?.length)) {
        throw new Error(`Wait for “${file.basename}” to finish indexing. Reference-style links need inline links before duplication.`);
      }
      if (forCopy && /<(?:img|video|audio|source|iframe|object)\b|\burl\s*\(/i.test(doc.body)) {
        throw new Error(`“${file.basename}” uses HTML/CSS media. Use native Markdown embeds before duplicating.`);
      }
      const note: NoteSnapshot = { file, path, content, doc, cache, links: new Map() };
      notes.push(note);
      if (doc.properties.emberly === "resource" && doc.properties["emberly-asset"]) {
        const media = this.index.resourceMedia(file, doc.properties);
        if (media.asset) { addAsset(media.asset); note.primaryAsset = media.asset.path; }
        else if (forCopy) throw new Error(media.issue ?? `Missing attachment in ${path}`);
      }
      // Links in both properties and note bodies, including the center photo.
      for (const ref of [...(cache?.links ?? []), ...(cache?.embeds ?? []), ...(cache?.frontmatterLinks ?? [])]) {
        if (remote(ref.link)) continue;
        const parsed = parseLinktext(ref.link);
        const target = parsed.path
          ? linkPathCandidates(parsed.path).map((candidate) => this.app.metadataCache.getFirstLinkpathDest(candidate, path)).find(Boolean)
          : file;
        if (!target) { if (forCopy) throw new Error(`Resolve “${ref.link}” in “${file.basename}” before duplicating.`); continue; }
        note.links.set(ref.link, { file: target, path: target.path });
        if (target.extension !== "md" || this.index.isMapAsset(target.path)) addAsset(target);
      }
    }
    const snapshot = { map, notes, assets: [...assets.values()] };
    await this.assertUnchanged(snapshot);
    return snapshot;
  }

  async assertUnchanged(snapshot: MapFileSnapshot): Promise<void> {
    const current = this.ownedFiles(snapshot.map.id);
    const paths = new Set(current.files.map((file) => file.path));
    if (current.map.path !== snapshot.map.path || paths.size !== snapshot.notes.length) throw new Error("The map changed during preparation. Try again.");
    for (const note of snapshot.notes) {
      this.assertActive();
      if (!paths.has(note.path) || note.file.path !== note.path || this.index.file(note.path) !== note.file
        || await this.app.vault.read(note.file) !== note.content) throw new Error(`“${note.path}” changed. Reopen the action to use its latest content.`);
      for (const link of note.links.values()) if (link.file.path !== link.path || this.index.file(link.path) !== link.file) throw new Error(`Linked file moved or disappeared: ${link.path}`);
    }
    for (const asset of snapshot.assets) if (!this.assetUnchanged(asset)) throw new Error(`“${asset.path}” changed. Try again.`);
  }

  private assetUnchanged(asset: AssetSnapshot): boolean {
    return asset.file.path === asset.path && this.index.file(asset.path) === asset.file
      && asset.file.stat.mtime === asset.mtime && asset.file.stat.size === asset.size;
  }

  async duplicate(snapshot: MapFileSnapshot, writeNote: (path: string, content: string) => Promise<TFile>): Promise<string> {
    await this.assertUnchanged(snapshot);
    const base = safeName(`Copy of ${snapshot.map.title}`), outer = parent(snapshot.map.folder) || "Emberly Maps";
    if (!safeVaultPath(outer)) throw new Error("Choose a normal vault folder for this map before duplicating it.");
    await ensureFolder(this.app, outer);
    let folder = "";
    // createFolder is the reservation: parallel copies never share a destination.
    for (let suffix = 1; suffix <= 1000; suffix++) {
      const candidate = join(outer, `${base}${suffix === 1 ? "" : ` (${suffix})`}`);
      this.assertActive();
      if (this.app.vault.getAbstractFileByPath(candidate)) continue;
      try { await this.app.vault.createFolder(candidate); folder = candidate; break; }
      catch (error) { if (!this.app.vault.getAbstractFileByPath(candidate)) throw error; }
    }
    if (!folder) throw new Error("Too many copies share this name.");
    this.index.reserveAssetFolder(join(folder, "Assets"));
    try {
      const paths = new Map<string, string>(), ids = new Map<string, string>(), topicIds = new Map<string, string>();
      const reserved = new Set<string>();
      const reserve = (directory: string, basename: string) => {
        for (let n = 1; n <= 1000; n++) {
          const path = join(directory, `${safeName(basename)}${n === 1 ? "" : ` (${n})`}.md`);
          if (!reserved.has(path.toLowerCase())) { reserved.add(path.toLowerCase()); return path; }
        }
        throw new Error("Too many notes have the same filename.");
      };
      for (const note of snapshot.notes) {
        const kind = note.doc.properties.emberly, id = this.index.allocateId();
        ids.set(note.path, id);
        if (kind === "topic") topicIds.set(String(note.doc.properties["emberly-id"]), id);
        if (kind === "map") {
          const path = join(folder, mapNoteFilename(folder.split("/").at(-1)!));
          reserved.add(path.toLowerCase());
          paths.set(note.path, path);
        } else {
          paths.set(note.path, reserve(join(folder, kind === "topic" ? "Topics" : "Resources"), note.file.basename));
        }
      }
      const sourceMapNote = snapshot.notes.find((note) => note.path === snapshot.map.path);
      const rootValue = sourceMapNote?.doc.properties["emberly-root-id"];
      const oldRootId = typeof rootValue === "string" ? rootValue : "";
      if (!oldRootId) throw new Error("The map has no stable root ID.");
      // A map-backed root has no separate topic note to allocate its copied ID.
      if (!topicIds.has(oldRootId)) topicIds.set(oldRootId, this.index.allocateId());
      const copiedAssets: { original: AssetSnapshot; copy: TFile; hash: string }[] = [];
      if (snapshot.assets.length) await ensureFolder(this.app, join(folder, "Assets"));
      for (const asset of snapshot.assets) {
        this.assertActive();
        if (!this.assetUnchanged(asset)) throw new Error(`Attachment changed: ${asset.path}`);
        const bytes = await this.app.vault.readBinary(asset.file), hash = await byteHash(bytes);
        const { stem, extension } = fileNameParts(asset.file.name);
        const copy = await createUnique(this.app, join(folder, "Assets"), stem, extension, (path) => this.app.vault.createBinary(path, bytes));
        if (await byteHash(await this.app.vault.readBinary(copy)) !== hash) throw new Error(`Attachment copy verification failed: ${copy.path}`);
        paths.set(asset.path, copy.path); copiedAssets.push({ original: asset, copy, hash });
      }
      const prepared = snapshot.notes.map((note) => {
        const doc = this.rewriteLinks(note, paths);
        const kind = doc.properties.emberly;
        doc.properties["emberly-id"] = ids.get(note.path)!;
        if (kind === "map") doc.properties["emberly-root-id"] = topicIds.get(String(doc.properties["emberly-root-id"]))!;
        else {
          doc.properties["emberly-map"] = ids.get(snapshot.map.path)!;
          const ownerKey = kind === "topic" ? "emberly-parent" : "emberly-topic";
          const ownerId = doc.properties[ownerKey];
          if (typeof ownerId === "string" && ownerId) doc.properties[ownerKey] = topicIds.get(ownerId)!;
        }
        if (kind === "resource" && doc.properties["emberly-asset"]) {
          const target = note.primaryAsset && paths.get(note.primaryAsset);
          if (!target) throw new Error(`Missing attachment copy for ${note.path}`);
          doc.properties["emberly-asset"] = target.slice(folder.length + 1);
        }
        return { source: note.path, path: paths.get(note.path)!, content: serializeNote(doc) };
      });
      await this.assertUnchanged(snapshot);
      // Publish the map note last, after every topic, resource and attachment.
      for (const note of prepared.filter((note) => note.source !== snapshot.map.path)) {
        this.assertActive(); await ensureFolder(this.app, parent(note.path)); await writeNote(note.path, note.content);
      }
      await this.assertUnchanged(snapshot);
      for (const asset of copiedAssets) {
        if (await byteHash(await this.app.vault.readBinary(asset.original.file)) !== asset.hash
          || await byteHash(await this.app.vault.readBinary(asset.copy)) !== asset.hash) throw new Error("An attachment changed while copying. The copy was not published.");
      }
      this.assertActive();
      const preparedMapNote = prepared.find((note) => note.source === snapshot.map.path)!;
      await writeNote(preparedMapNote.path, preparedMapNote.content);
      return preparedMapNote.path;
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} Originals were not changed. Partial copy files are kept in “${folder}”.`);
    }
  }

  private rewriteLinks(note: NoteSnapshot, paths: Map<string, string>): Document {
    const doc = frontmatter(note.content), headerLength = note.content.length - doc.body.length;
    const resolve = (link: string): string => {
      const parsed = parseLinktext(link);
      // Resolve against the original vault snapshot, not newly created same-name files.
      const target = note.links.get(link);
      if (!target || target.file.path !== target.path || this.index.file(target.path) !== target.file) throw new Error(`Unresolved or changed link: ${link}`);
      const path = paths.get(target.path) ?? target.path;
      if (hasSpecialLinkCharacter(path)) throw new Error(`Rename “${path}” to remove special link characters before duplicating.`);
      return path + parsed.subpath;
    };
    const replacements: { start: number; end: number; value: string }[] = [];
    for (const ref of [...(note.cache?.links ?? []), ...(note.cache?.embeds ?? [])]) {
      if (remote(ref.link)) continue;
      const start = ref.position.start.offset, end = ref.position.end.offset;
      if (start < headerLength || note.content.slice(start, end) !== ref.original) throw new Error("Link metadata changed. Wait for indexing and retry.");
      const wiki = /^(!?)\[\[([\s\S]*?)\]\]$/.exec(ref.original);
      const alias = wiki ? (wiki[2]!.includes("|") ? "|" + wiki[2]!.split("|").slice(1).join("|") : "")
        : ref.displayText ? `|${ref.displayText.replace(/\|/g, "&#124;").replace(/\]/g, "&#93;")}` : "";
      replacements.push({ start: start - headerLength, end: end - headerLength, value: `${ref.original.startsWith("!") ? "!" : ""}[[${resolve(ref.link)}${alias}]]` });
    }
    for (const ref of note.cache?.frontmatterLinks ?? []) {
      if (remote(ref.link)) continue;
      const value = `[[${resolve(ref.link)}${ref.displayText ? `|${ref.displayText}` : ""}]]`;
      const replace = (entry: unknown): unknown => typeof entry === "string" ? entry.split(ref.original).join(value)
        : Array.isArray(entry) ? entry.map(replace) : entry && typeof entry === "object" ? Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, replace(item)])) : entry;
      doc.properties = replace(doc.properties) as Record<string, unknown>;
    }
    let boundary = Infinity;
    for (const edit of replacements.sort((a, b) => b.start - a.start)) {
      if (edit.end > boundary) throw new Error("Overlapping links cannot be duplicated safely.");
      doc.body = doc.body.slice(0, edit.start) + edit.value + doc.body.slice(edit.end); boundary = edit.start;
    }
    return doc;
  }

  async trash(snapshot: MapFileSnapshot, closeViews: () => void): Promise<{ notes: number; assets: number; kept: number }> {
    await this.assertUnchanged(snapshot);
    const owned = new Set(snapshot.notes.map((note) => note.path));
    // Only referenced map-local assets are candidates. Unknown/shared files stay.
    const localAssets = snapshot.assets.filter((asset) => snapshot.map.folder && asset.path.startsWith(join(snapshot.map.folder, "Assets") + "/") && safeVaultPath(asset.path));
    const references = () => this.app.vault.getFiles().filter((file) => !owned.has(file.path) && ["md", "canvas", "base"].includes(file.extension));
    const otherFiles = references(), stamps: { file: TFile; path: string; mtime: number; size: number }[] = [];
    const protectedAssets = new Set<string>();
    for (const file of otherFiles) {
      this.assertActive();
      const stamp = { file, path: file.path, mtime: file.stat.mtime, size: file.stat.size };
      const content = await this.app.vault.read(file);
      let decoded = content; try { decoded = decodeURIComponent(content); } catch { /* Scan original as well. */ }
      const haystack = (content + "\n" + decoded).toLowerCase();
      for (const asset of localAssets) {
        if ([asset.path, relativeLink(file.path, asset.path), asset.file.name, asset.file.basename]
          .some((needle) => needle && haystack.includes(needle.toLowerCase()))) protectedAssets.add(asset.path);
      }
      stamps.push(stamp);
    }
    const canRemoveAssets = () => references().length === stamps.length && stamps.every((stamp) => this.index.file(stamp.path) === stamp.file
      && stamp.file.path === stamp.path && stamp.file.stat.mtime === stamp.mtime && stamp.file.stat.size === stamp.size);
    await this.assertUnchanged(snapshot);
    if (snapshot.map.folder) this.index.reserveAssetFolder(join(snapshot.map.folder, "Assets"));
    closeViews();
    let notes = 0, assets = 0;
    try {
      // Never recursively delete a folder; no unrelated files can be swept up.
      for (const note of [...snapshot.notes.filter((note) => note.path !== snapshot.map.path), snapshot.notes.find((note) => note.path === snapshot.map.path)!]) {
        this.assertActive();
        if (this.index.sources().some((source) => source.frontmatter["emberly-map"] === snapshot.map.id && !owned.has(source.path))) {
          throw new Error("A note was added to the map during deletion. Restore the trashed files before trying again.");
        }
        if (note.file.path !== note.path || this.index.file(note.path) !== note.file || await this.app.vault.read(note.file) !== note.content) {
          throw new Error(`“${note.path}” changed while moving the map to trash.`);
        }
        await this.app.fileManager.trashFile(note.file); this.index.remove(note.path); notes++;
      }
      for (const asset of localAssets) {
        this.assertActive();
        if (protectedAssets.has(asset.path) || !canRemoveAssets() || !this.assetUnchanged(asset)) continue;
        await this.app.fileManager.trashFile(asset.file); assets++;
      }
      return { notes, assets, kept: snapshot.assets.length - assets };
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} Moved ${notes} notes and ${assets} attachments to Obsidian's configured trash; restore them there if needed. Remaining files were kept.`);
    }
  }
}
