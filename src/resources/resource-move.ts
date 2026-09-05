import { parseLinktext, type App, type TFile, type ReferenceCache } from "obsidian";
import { frontmatter, ensureFolder, relativeLink, serializeNote } from "../vault/vault-files";
import type { ResourceTarget } from "./resource-create";
import { nextResourceOrder, type OwnedResource } from "./resource-catalog";
import { byteHash, finishResourceTransfer, safeVaultPath, validateTransfer, type ResourceTransfer, type TransferIO, type TransferCopy } from "./resource-transfer";
import type { EmberlyVaultIndex } from "../vault/vault-index";
import { RESOURCE_TOPIC_LINK_PROPERTY, resourceTopicLink } from "./resource-topic-link";
import { hasSpecialLinkCharacter } from "../shared/text-validation";

const folder = (path: string): string => path.split("/").slice(0, -1).join("/");
const join = (parent: string, child: string): string => parent ? `${parent}/${child}` : child;

/** No renderer/editor internals: Vault, MetadataCache and FileManager only. */
export class ResourceMoves {
  constructor(private readonly app: App, private readonly index: EmberlyVaultIndex,
    private readonly persistJournal: (plan: ResourceTransfer | null) => Promise<void>,
    private readonly expectWrite: (path: string, content: string) => void) {}

  async validateTarget(target: ResourceTarget): Promise<string> {
    const maps = this.index.maps().filter((map) => map.id === target.mapId), map = maps[0];
    if (maps.length !== 1 || !map || map.format !== 2 || map.issues.length
      || !map.nodes.some((node) => node.id === target.id && node.path === target.file.path)
      || this.index.file(target.file.path) !== target.file) throw new Error("The target topic or map is missing or ambiguous.");
    if (!map.nodes.find((node) => node.id === target.id)!.parentId) throw new Error("The map root cannot own resources. Choose a non-root topic.");
    const mapFile = this.index.file(map.path);
    if (!mapFile) throw new Error("The map note is missing.");
    const mapDoc = frontmatter(await this.app.vault.read(mapFile));
    const topic = frontmatter(await this.app.vault.read(target.file)).properties;
    if (mapDoc.properties["emberly-root-id"] === target.id || typeof topic["emberly-parent"] !== "string" || !topic["emberly-parent"].trim()) {
      throw new Error("The map root cannot own resources. Choose a non-root topic.");
    }
    if (mapDoc.properties["emberly-id"] !== target.mapId || mapDoc.properties.emberly !== "map" || mapDoc.properties["emberly-format"] !== 2
      || mapDoc.properties["emberly-root-id"] !== map.nodes.find((node) => !node.parentId)?.id
      || topic.emberly !== "topic" || topic["emberly-format"] !== 2 || topic["emberly-map"] !== target.mapId || topic["emberly-id"] !== target.id) {
      throw new Error("The destination changed. Choose the topic again.");
    }
    return folder(map.path);
  }

  private async checkResource(resource: OwnedResource): Promise<{ file: TFile; content: string }> {
    const matches = this.index.resourceCatalog().resources.filter((item) => item.id === resource.id), current = matches[0];
    const file = this.index.file(resource.path);
    if (!file || matches.length !== 1 || current?.path !== resource.path || current.mapId !== resource.mapId || current.topicId !== resource.topicId || current.order !== resource.order) {
      throw new Error("This resource moved or its ownership is invalid. Select it again.");
    }
    const content = await this.app.vault.read(file), fm = frontmatter(content).properties;
    if (fm.emberly !== "resource" || fm["emberly-format"] !== 2 || fm["emberly-id"] !== resource.id || fm["emberly-map"] !== resource.mapId || fm["emberly-topic"] !== resource.topicId || fm["emberly-order"] !== resource.order) {
      throw new Error("The resource changed while Move was open. Select it again.");
    }
    return { file, content };
  }

  async move(resource: OwnedResource, target: ResourceTarget): Promise<{ path: string; kept: string[] }> {
    const { file, content } = await this.checkResource(resource);
    const sourcePath = file.path;
    const destinationFolder = await this.validateTarget(target);
    if (target.mapId === resource.mapId && target.id === resource.topicId) return { path: file.path, kept: [] };
    const doc = frontmatter(content);
    doc.properties["emberly-map"] = target.mapId;
    doc.properties["emberly-topic"] = target.id;
    doc.properties["emberly-order"] = nextResourceOrder(this.index.resourceCatalog().resources, target.mapId, target.id);
    if (target.mapId === resource.mapId) {
      doc.properties[RESOURCE_TOPIC_LINK_PROPERTY] = resourceTopicLink(this.app.metadataCache, file.path, target.file);
      await this.validateTarget(target);
      await this.app.fileManager.processFrontMatter(file, (properties: Record<string, unknown>) => {
        if (file.path !== sourcePath || properties.emberly !== "resource" || properties["emberly-format"] !== 2
          || properties["emberly-id"] !== resource.id || properties["emberly-map"] !== resource.mapId
          || properties["emberly-topic"] !== resource.topicId || properties["emberly-order"] !== resource.order) {
          throw new Error("The resource changed while Move was open. Select it again.");
        }
        properties["emberly-topic"] = target.id;
        properties["emberly-order"] = doc.properties["emberly-order"];
        properties[RESOURCE_TOPIC_LINK_PROPERTY] = doc.properties[RESOURCE_TOPIC_LINK_PROPERTY];
      });
      // Refresh the index without attributing a later editor save to this move.
      this.index.setContent(file.path, await this.app.vault.read(file));
      return { path: file.path, kept: [] };
    }
    const sourceMap = this.index.maps().find((map) => map.id === resource.mapId);
    if (!sourceMap || !sourceMap.folder || !destinationFolder) throw new Error("Cross-map moves require separate map folders, not a map at the vault root.");
    if (sourceMap.folder === destinationFolder) throw new Error("Self-contained maps must have separate folders.");
    const destinationAssets = join(destinationFolder, "Assets"), sourceAssets = join(sourceMap.folder, "Assets");
    const destination = this.unusedPath(join(destinationFolder, "Resources"), file.name, new Set());
    for (let attempt = 0; attempt < 60 && !this.index.referenceCacheCurrent(file.path, content); attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (!this.index.referenceCacheCurrent(file.path, content)) throw new Error("Obsidian is still indexing the saved note. Retry Move when indexing finishes.");
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache || cache.referenceLinks?.length) throw new Error("Wait for Obsidian to index this note. Reference-style links must be converted to inline links before a cross-map move.");
    // HTML media and CSS URLs are not represented by Obsidian's link cache.
    if (/<(?:img|video|audio|source|iframe|object)\b|\burl\s*\(/i.test(doc.body)) throw new Error("This note contains HTML/CSS media. Use native Markdown links before moving it across maps.");
    const copies: TransferCopy[] = [], copied = new Map<string, string>(), reserved = new Set<string>();
    let total = 0;
    const attachment = async (asset: TFile): Promise<string> => {
      if (copied.has(asset.path)) return copied.get(asset.path)!;
      if (asset.stat.size > 100 * 1024 * 1024 - total) throw new Error("This transfer exceeds 100 MiB. No resource ownership was changed.");
      const bytes = await this.app.vault.readBinary(asset);
      total += bytes.byteLength;
      if (total > 100 * 1024 * 1024) throw new Error("This transfer exceeds 100 MiB. No resource ownership was changed.");
      const to = this.unusedPath(destinationAssets, asset.name, reserved);
      copies.push({ from: asset.path, to, hash: await byteHash(bytes) }); copied.set(asset.path, to);
      return to;
    };
    const primary = typeof doc.properties["emberly-asset"] === "string" ? doc.properties["emberly-asset"] : "";
    if (primary) {
      const media = this.index.resourceMedia(file, frontmatter(content).properties);
      if (!media.asset) throw new Error(media.issue ?? "The resource attachment is missing.");
      doc.properties["emberly-asset"] = (await attachment(media.asset)).slice(destinationFolder.length + 1);
    }
    const resolveLink = async (link: string): Promise<string> => {
      const parsed = parseLinktext(link);
      const resolved = parsed.path ? this.app.metadataCache.getFirstLinkpathDest(parsed.path, file.path) : file;
      if (!resolved) throw new Error(`Unresolved link “${link}”. Repair it before moving this resource across maps.`);
      const path = resolved === file ? destination : resolved.extension !== "md" || resolved.path.startsWith(sourceAssets + "/")
        ? await attachment(resolved) : resolved.path;
      if (hasSpecialLinkCharacter(path)) throw new Error(`Rename “${path}” to remove special link characters before moving.`);
      return path + parsed.subpath;
    };
    const headerLength = content.length - frontmatter(content).body.length;
    const refs: ReferenceCache[] = [...(cache.links ?? []), ...(cache.embeds ?? [])];
    const replacements: { start: number; end: number; value: string }[] = [];
    for (const ref of refs) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref.link) && !/^file:/i.test(ref.link)) continue;
      const start = ref.position.start.offset, end = ref.position.end.offset;
      if (content.slice(start, end) !== ref.original || start < headerLength) throw new Error("Obsidian's link index is still updating. Try Move again after saving the note.");
      const targetPath = await resolveLink(ref.link);
      const wiki = /^(!?)\[\[([\s\S]*?)\]\]$/.exec(ref.original);
      const alias = wiki ? (wiki[2]!.includes("|") ? "|" + wiki[2]!.split("|").slice(1).join("|") : "")
        : ref.displayText ? `|${ref.displayText.replace(/\|/g, "&#124;").replace(/\]/g, "&#93;")}` : "";
      replacements.push({ start: start - headerLength, end: end - headerLength, value: `${ref.original.startsWith("!") ? "!" : ""}[[${targetPath}${alias}]]` });
    }
    for (const ref of cache.frontmatterLinks ?? []) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref.link) && !/^file:/i.test(ref.link)) continue;
      const replacement = `[[${await resolveLink(ref.link)}${ref.displayText ? `|${ref.displayText}` : ""}]]`;
      const update = (value: unknown): unknown => typeof value === "string" ? value.split(ref.original).join(replacement)
        : Array.isArray(value) ? value.map(update) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, update(child)])) : value;
      doc.properties = update(doc.properties) as Record<string, unknown>;
    }
    doc.properties[RESOURCE_TOPIC_LINK_PROPERTY] = resourceTopicLink(this.app.metadataCache, destination, target.file);
    let last = Infinity;
    for (const patch of replacements.sort((a, b) => b.start - a.start)) {
      if (patch.end > last) throw new Error("Overlapping Markdown links cannot be moved safely.");
      doc.body = doc.body.slice(0, patch.start) + patch.value + doc.body.slice(patch.end); last = patch.start;
    }
    await this.validateTarget(target);
    if (file.path !== sourcePath || await this.app.vault.read(file) !== content) throw new Error("The resource moved or changed during transfer preparation. Try again.");
    await ensureFolder(this.app, join(destinationFolder, "Resources"));
    if (copies.length) await ensureFolder(this.app, destinationAssets);
    const plan: ResourceTransfer = { version: 1, id: resource.id, source: file.path, destination, sourceAssets, destinationAssets, before: content, after: serializeNote(doc), copies };
    return finishResourceTransfer(this.io(plan), plan);
  }

  async recover(value: unknown): Promise<{ path: string; kept: string[] }> {
    const plan = validateTransfer(value);
    return finishResourceTransfer(this.io(plan), plan, true);
  }

  private unusedPath(directory: string, name: string, reserved: Set<string>): string {
    if (!safeVaultPath(directory) || !safeVaultPath(name)) throw new Error("Unsafe resource file path.");
    const dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, extension = dot > 0 ? name.slice(dot) : "";
    for (let n = 1; n <= 1000; n++) {
      const path = `${directory}/${stem}${n === 1 ? "" : ` (${n})`}${extension}`;
      if (this.app.vault.getAbstractFileByPath(path) || reserved.has(path.toLowerCase())) continue;
      reserved.add(path.toLowerCase()); return path;
    }
    throw new Error("Too many matching resource filenames.");
  }
  private async compareAndWrite(path: string, before: string, after: string): Promise<void> {
    const file = this.index.file(path);
    if (!file) throw new Error("The resource note is missing.");
    const result = await this.app.vault.process(file, (latest) => {
      if (latest !== before) throw new Error("The resource was edited during the move. Your latest edits were kept; retry after saving.");
      this.expectWrite(path, after); return after;
    });
    this.index.setContent(path, result);
  }
  private io(plan: ResourceTransfer): TransferIO {
    return {
      read: async (path) => { const file = this.index.file(path); return file ? this.app.vault.read(file) : undefined; },
      readBinary: async (path) => { const file = this.index.file(path); if (!file) throw new Error(`Missing attachment: ${path}`); return this.app.vault.readBinary(file); },
      exists: (path) => Boolean(this.app.vault.getAbstractFileByPath(path)),
      createBinary: async (path, bytes) => { await this.app.vault.createBinary(path, bytes); },
      compareAndWrite: (path, before, after) => this.compareAndWrite(path, before, after),
      rename: async (from, to) => {
        const file = this.index.file(from);
        if (!file || this.app.vault.getAbstractFileByPath(to)) throw new Error("Resource move path is missing or occupied.");
        await this.app.fileManager.renameFile(file, to); this.index.rename(to, from);
        this.index.setContent(to, await this.app.vault.read(file));
      },
      journal: this.persistJournal,
      validate: async (plan) => {
        const before = frontmatter(plan.before).properties, after = frontmatter(plan.after).properties;
        if (before.emberly !== "resource" || after.emberly !== "resource" || before["emberly-format"] !== 2 || after["emberly-format"] !== 2
          || before["emberly-id"] !== plan.id || after["emberly-id"] !== plan.id || before["emberly-map"] === after["emberly-map"]) throw new Error("Invalid transfer ownership metadata.");
        const maps = this.index.maps();
        const source = maps.filter((map) => map.id === before["emberly-map"]), destination = maps.filter((map) => map.id === after["emberly-map"]);
        if (source.length !== 1 || destination.length !== 1 || join(source[0]!.folder, "Assets") !== plan.sourceAssets || join(destination[0]!.folder, "Assets") !== plan.destinationAssets) throw new Error("A map moved or became ambiguous during transfer.");
        const node = destination[0]!.nodes.find((node) => node.id === after["emberly-topic"]), file = node && this.index.file(node.path);
        if (!node || !file) throw new Error("The destination topic is missing.");
        await this.validateTarget({ file, id: node.id, mapId: destination[0]!.id });
        const duplicates = this.index.sources().filter((source) => source.frontmatter.emberly === "resource" && source.frontmatter["emberly-id"] === plan.id);
        if (duplicates.length !== 1 || ![plan.source, plan.destination].includes(duplicates[0]!.path)) throw new Error("Duplicate or missing resource identity during transfer.");
      },
      cleanup: (copy) => this.trashIfUnused(copy, plan),
    };
  }

  /** Conservative scan: any possible reference retains the original, even in code. */
  private async trashIfUnused(copy: TransferCopy, plan: ResourceTransfer): Promise<boolean> {
    const file = this.index.file(copy.from);
    if (!file) return true;
    if (await byteHash(await this.app.vault.readBinary(file)) !== copy.hash) return false;
    const snapshots: [TFile, number, number][] = [];
    const referenceFiles = (): TFile[] => this.app.vault.getFiles().filter((candidate) => ["md", "canvas", "base"].includes(candidate.extension));
    for (const note of referenceFiles()) {
      const mtime = note.stat.mtime, size = note.stat.size;
      const text = await this.app.vault.read(note);
      if (note.path === plan.destination && text === plan.after) { snapshots.push([note, mtime, size]); continue; }
      let decoded = text;
      try { decoded = decodeURIComponent(text); } catch { /* Original text still checked. */ }
      const haystack = (text + "\n" + decoded).toLowerCase();
      const needles = [copy.from, relativeLink(note.path, copy.from), file.name, file.basename];
      if (needles.some((needle) => needle && haystack.includes(needle.toLowerCase()))) return false;
      snapshots.push([note, mtime, size]);
    }
    if (snapshots.length !== referenceFiles().length || snapshots.some(([note, mtime, size]) => this.index.file(note.path) !== note || note.stat.mtime !== mtime || note.stat.size !== size)) return false;
    if (await byteHash(await this.app.vault.readBinary(file)) !== copy.hash) return false;
    const verifiedCopy = this.index.file(copy.to);
    if (!verifiedCopy || await byteHash(await this.app.vault.readBinary(verifiedCopy)) !== copy.hash) return false;
    await this.app.fileManager.trashFile(file);
    return true;
  }
}
