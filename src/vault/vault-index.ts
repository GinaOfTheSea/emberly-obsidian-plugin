import { App, TFile, TFolder, parseYaml } from "obsidian";
import { indexEmberlyFiles } from "../maps/model";
import type { TopicResources } from "../resources/resource-list";
import { buildResourceCatalog, withResourceFlags, type ResourceCatalog } from "../resources/resource-catalog";
import type { EmberlyMap, SourceFile } from "../shared/types";
import { resourceIdentity, resourceTags, resourceTagSuggestions } from "../resources/resource-properties";
import { NoteIdAllocator } from "./note-metadata";
import { CENTER_IMAGE_EXTENSIONS, CENTER_IMAGE_LIMIT } from "../maps/map-center";
import { hasAsciiControl } from "../shared/text-validation";

export interface ResourceMedia { asset?: TFile; thumbnail?: string; issue?: string; }

export class EmberlyVaultIndex {
  private snapshot?: { sources?: SourceFile[]; hierarchy?: EmberlyMap[]; maps?: EmberlyMap[]; catalog?: ResourceCatalog };

  /** Share derived data only during synchronous work; never across an await or event. */
  withSnapshot<T>(action: () => T): T {
    if (this.snapshot) return action();
    this.snapshot = {};
    try { return action(); } finally { this.snapshot = undefined; }
  }

  private invalidateSnapshot(): void { if (this.snapshot) this.snapshot = {}; }
  private readonly contents = new Map<string, string>();
  private readonly properties = new Map<string, Record<string, unknown>>();
  private readonly referenceContents = new Map<string, string>();
  private readonly pendingMetadata = new Set<string>();
  private readonly pendingHierarchy = new Set<string>();
  private readonly reservedAssetFolders = new Set<string>();
  private readonly rememberedProperties = new WeakMap<TFile, Record<string, unknown>>();
  private readonly ids = new NoteIdAllocator(() => this.sources().flatMap((source) => {
    const id = source.frontmatter["emberly-id"];
    return typeof id === "string" ? [id] : [];
  }));
  constructor(private readonly app: App) {}
  allocateId(): string { return this.ids.allocate(); }
  /** Keep opaque .md uploads out of the index while their map is being copied/trashed. */
  reserveAssetFolder(path: string): void { this.reservedAssetFolders.add(path); this.invalidateSnapshot(); }

  /** Assets are opaque attachments, even when an uploaded .md has Emberly YAML. */
  isMapAsset(path: string): boolean {
    if ([...this.reservedAssetFolders].some((folder) => path.startsWith(folder + "/"))) return true;
    const parts = path.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] !== "Assets") continue;
      const parentPath = parts.slice(0, i).join("/");
      const parent = parentPath ? this.app.vault.getAbstractFileByPath(parentPath) : this.app.vault.getRoot();
      if (!(parent instanceof TFolder)) continue;
      if (parent.children.some((file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return false;
        const fm = this.propertiesFor(file);
        return fm?.emberly === "map" && fm["emberly-format"] === 2;
      })) return true;
    }
    return false;
  }

  private markdownNotes(): TFile[] { return this.app.vault.getMarkdownFiles().filter((file) => !this.isMapAsset(file.path)); }

  async initialize(): Promise<boolean> {
    // Hierarchy is metadata-owned. Remember identities without reading map bodies.
    for (const file of this.markdownNotes()) this.propertiesFor(file);
    return false;
  }

  setContent(path: string, content: string): void {
    this.invalidateSnapshot();
    this.pendingHierarchy.delete(path);
    this.contents.set(path, content);
    try {
      const header = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
      const fm: unknown = header ? parseYaml(header[1]!) : {};
      this.properties.set(path, fm && typeof fm === "object" && !Array.isArray(fm) ? fm as Record<string, unknown> : {});
    } catch { this.properties.set(path, {}); }
  }
  propertiesFor(file: TFile): Record<string, unknown> {
    const local = this.properties.get(file.path);
    const cache = this.app.metadataCache.getFileCache(file);
    // A missing cache during a native rename isn't a metadata deletion. A
    // present cache with no frontmatter is, and must not resurrect old identity.
    const value = local ?? (cache ? cache.frontmatter ?? {} : this.rememberedProperties.get(file) ?? {});
    this.rememberedProperties.set(file, value);
    return value;
  }
  metadataPending(path: string): void { this.pendingMetadata.add(path); this.pendingHierarchy.add(path); }
  metadataObserved(path: string, content: string): void { this.referenceContents.set(path, content); this.pendingMetadata.delete(path); }
  referenceCacheCurrent(path: string, content: string): boolean {
    const observed = this.referenceContents.get(path);
    return observed === undefined ? !this.pendingMetadata.has(path) : observed === content;
  }
  /** Don't infer an empty map while new/changed notes are awaiting metadata.
   * Locally saved/read snapshots are current even before link metadata resolves. */
  hierarchySettled(mapId: string): boolean {
    return this.markdownNotes().every((file) => {
      if (!this.properties.has(file.path) && !this.app.metadataCache.getFileCache(file)) return false;
      const fm = this.propertiesFor(file);
      return !this.pendingHierarchy.has(file.path)
        || (fm["emberly-map"] !== mapId && !(fm.emberly === "map" && fm["emberly-id"] === mapId));
    });
  }
  remove(path: string): void {
    this.invalidateSnapshot();
    for (const key of this.contents.keys()) if (key === path || key.startsWith(`${path}/`)) this.contents.delete(key);
    for (const key of this.properties.keys()) if (key === path || key.startsWith(`${path}/`)) this.properties.delete(key);
    for (const key of this.referenceContents.keys()) if (key === path || key.startsWith(`${path}/`)) this.referenceContents.delete(key);
    for (const key of this.pendingMetadata) if (key === path || key.startsWith(`${path}/`)) this.pendingMetadata.delete(key);
    for (const key of this.pendingHierarchy) if (key === path || key.startsWith(`${path}/`)) this.pendingHierarchy.delete(key);
  }
  rename(path: string, oldPath: string): void {
    this.invalidateSnapshot();
    for (const cache of [this.contents, this.properties, this.referenceContents] as Map<string, unknown>[]) {
      for (const [key, value] of [...cache]) {
        if (key !== oldPath && !key.startsWith(`${oldPath}/`)) continue;
        cache.delete(key);
        cache.set(path + key.slice(oldPath.length), value);
      }
    }
    for (const key of [...this.pendingMetadata]) {
      if (key !== oldPath && !key.startsWith(`${oldPath}/`)) continue;
      this.pendingMetadata.delete(key);
      this.pendingMetadata.add(path + key.slice(oldPath.length));
    }
    for (const key of [...this.pendingHierarchy]) {
      if (key !== oldPath && !key.startsWith(`${oldPath}/`)) continue;
      this.pendingHierarchy.delete(key);
      this.pendingHierarchy.add(path + key.slice(oldPath.length));
    }
  }

  sources(): SourceFile[] {
    if (this.snapshot?.sources) return this.snapshot.sources;
    const sources = this.markdownNotes().map((file) => ({
      path: file.path,
      basename: file.basename,
      frontmatter: this.propertiesFor(file),
      content: this.contents.get(file.path),
      hasNotes: this.app.metadataCache.getFileCache(file)?.sections?.some((section) => section.type !== "yaml"),
    }));
    if (this.snapshot) this.snapshot.sources = sources;
    return sources;
  }

  maps(): EmberlyMap[] {
    if (this.snapshot?.maps) return this.snapshot.maps;
    const files = this.sources(), maps = this.hierarchy(files);
    for (const map of maps) {
      if (map.center?.mode === "image") Object.assign(map.center, this.centerMedia(map));
    }
    const catalog = this.snapshot?.catalog ?? buildResourceCatalog(files, maps);
    const result = withResourceFlags(maps, catalog);
    if (this.snapshot) { this.snapshot.maps = result; this.snapshot.catalog = catalog; }
    return result;
  }

  private hierarchy(files: SourceFile[]): EmberlyMap[] {
    if (this.snapshot?.hierarchy) return this.snapshot.hierarchy;
    const maps = indexEmberlyFiles(files);
    if (this.snapshot) this.snapshot.hierarchy = maps;
    return maps;
  }

  private centerMedia(map: EmberlyMap): { imageUrl?: string; issue?: string } {
    // A frontmatter wikilink lets native Obsidian renames track this attachment.
    // Never pass untrusted remote URLs or arbitrary URI schemes to Pixi.
    const image = map.center?.image ?? "";
    const target = image.startsWith("[[") && image.endsWith("]]" ) ? image.slice(2, -2) : undefined;
    const validTarget = target && !target.includes("[") && !target.includes("]") && !target.includes("\r") && !target.includes("\n") ? target : undefined;
    const path = validTarget?.split("|")[0]?.split("#")[0]?.trim();
    if (!path || path.includes(":") || path.includes("\\") || hasAsciiControl(path) || path.startsWith("/")) {
      return { issue: "Choose a local center image. Its property must be a quoted vault wikilink." };
    }
    const file = this.app.metadataCache.getFirstLinkpathDest(path, map.path) ?? this.file(path);
    if (!file) return { issue: "The center image is missing. Choose another image or restore the attachment." };
    if (!CENTER_IMAGE_EXTENSIONS.test(file.extension) || file.stat.size > CENTER_IMAGE_LIMIT) {
      return { issue: "Use a PNG, JPEG, GIF, WebP or AVIF center image up to 20 MiB." };
    }
    const url = this.app.vault.getResourcePath(file);
    return { imageUrl: `${url}${url.includes("?") ? "&" : "?"}emberly-center=${file.stat.mtime}` };
  }
  resourceCatalog(): ResourceCatalog {
    if (this.snapshot?.catalog) return this.snapshot.catalog;
    const files = this.sources();
    const catalog = buildResourceCatalog(files, this.hierarchy(files));
    if (this.snapshot) this.snapshot.catalog = catalog;
    return catalog;
  }

  mapByPath(path: string): EmberlyMap | undefined {
    return this.maps().find((map) => map.path === path);
  }

  mapContaining(path: string): EmberlyMap | undefined {
    return this.maps().find((map) => map.path === path || map.nodes.some((node) => node.path === path));
  }

  /** Rebuilt from note metadata: no hidden tag store or folder-name ownership. */
  resourceTagsForMap(mapId: string): string[] {
    const tags: string[] = [];
    for (const file of this.markdownNotes()) {
      const properties = this.propertiesFor(file);
      if (resourceIdentity(properties)?.mapId === mapId) tags.push(...resourceTags(properties.tags));
    }
    return resourceTagSuggestions(tags, [], "");
  }

  resourcesForTopic(path: string, _content?: string): TopicResources {
    return this.withSnapshot(() => this.topicResources(path));
  }

  private topicResources(path: string): TopicResources {
    const topic = this.file(path);
    const properties = topic && this.propertiesFor(topic);
    const mapId = properties?.["emberly-map"];
    if (properties?.emberly !== "topic" || properties["emberly-format"] !== 2 || typeof mapId !== "string") {
      return { resources: [], issues: [] };
    }
    const files = this.sources(), catalog = this.resourceCatalog();
    const result: TopicResources = {
      resources: catalog.resources.filter((resource) => resource.mapId === mapId && resource.topicId === properties["emberly-id"]),
      issues: catalog.issues.filter((issue) => issue.mapId === mapId).map((issue) => issue.message),
    };
    for (const resource of result.resources) {
      if (resource.kind !== "image") continue;
      const file = this.file(resource.path);
      if (file) resource.thumbnail = this.resourceMedia(file, undefined, files).thumbnail;
    }
    return result;
  }

  /** Resolve only vault files. A stale asset needs one unambiguous native link. */
  resourceMedia(file: TFile, properties = this.propertiesFor(file), sources?: SourceFile[]): ResourceMedia {
    const kind = properties["emberly-kind"];
    if (kind !== "image" && kind !== "file") return {};
    const assetPath = typeof properties["emberly-asset"] === "string" ? properties["emberly-asset"] : "";
    if (assetPath && (assetPath.includes(":") || assetPath.includes("\\") || hasAsciiControl(assetPath) || assetPath.startsWith("/") || assetPath.split("/").some((part) => part === ".." || part === "."))) {
      return { issue: "The attachment path is not a safe map-relative path. Check Details." };
    }
    const maps = (sources ?? this.sources()).filter((source) => source.frontmatter.emberly === "map" && source.frontmatter["emberly-id"] === properties["emberly-map"]);
    if (maps.length > 1) return { issue: "Multiple map notes share this map ID. The attachment is ambiguous." };
    const mapFolder = maps.length === 1 ? maps[0]!.path.split("/").slice(0, -1).join("/") : undefined;
    let asset = assetPath && mapFolder !== undefined ? this.file([mapFolder, assetPath].filter(Boolean).join("/")) : undefined;
    if (!asset) {
      const cache = this.app.metadataCache.getFileCache(file);
      const extension = assetPath.split("/").at(-1)?.split(".").slice(1).pop()?.toLowerCase();
      const linked = new Map<string, TFile>();
      for (const ref of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
        const target = this.app.metadataCache.getFirstLinkpathDest(ref.link, file.path);
        if (!target || (target.extension === "md" && !this.isMapAsset(target.path)) || (extension && target.extension.toLowerCase() !== extension)) continue;
        if (kind === "image" && !/^(png|jpe?g|gif|webp|avif|svg|bmp|tiff?)$/i.test(target.extension)) continue;
        linked.set(target.path, target);
      }
      if (linked.size > 1) return { issue: "The attachment is missing and several linked files could match. Check Details." };
      asset = [...linked.values()][0];
    }
    if (!asset) return { issue: "The attachment is missing or was not included in the export." };
    // SVG/HTML and remote previews are intentionally not rendered as images.
    const thumbnail = /^(png|jpe?g|gif|webp|avif)$/i.test(asset.extension) && asset.stat.size <= 20 * 1024 * 1024
      ? this.app.vault.getResourcePath(asset) : undefined;
    return { asset, thumbnail };
  }

  file(path: string): TFile | undefined {
    const candidate = this.app.vault.getAbstractFileByPath(path);
    return candidate instanceof TFile ? candidate : undefined;
  }
}
