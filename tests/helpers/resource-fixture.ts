import { mkdtemp, mkdir, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep, dirname, posix } from "node:path";
import type { App, TFile as ObsidianFile, CachedMetadata } from "obsidian";
import { TFile, TFolder, parseYaml, stringifyYaml } from "./obsidian-mock";
import { EmberlyVaultIndex } from "../../src/vault/vault-index";
import type { ResourceTransfer } from "../../src/resources/resource-transfer";
import { ResourceMoves } from "../../src/resources/resource-move";

export const note = (fm: Record<string, unknown>, body = "# Notes\n"): string => `---\n${JSON.stringify(fm, null, 2)}\n---\n${body}`;
export class ResourceFixture {
  readonly files = new Map<string, TFile | TFolder>();
  readonly mutations: string[] = [];
  readonly app: App;
  readonly index: EmberlyVaultIndex;
  pending: ResourceTransfer | null = null;
  failRename = false;
  failCreate = false;
  staleCache = false;
  beforeProcess?: () => Promise<void>;
  private folderCreates: Promise<void> = Promise.resolve();
  constructor(readonly root: string) {
    this.files.set("", new TFolder(""));
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => this.files.get(path),
        getRoot: () => this.files.get(""),
        getMarkdownFiles: () => [...this.files.values()].filter((file): file is TFile => file instanceof TFile && file.extension === "md"),
        getFiles: () => [...this.files.values()].filter((file): file is TFile => file instanceof TFile),
        cachedRead: (file: TFile) => this.read(file.path), read: (file: TFile) => this.read(file.path),
        readBinary: async (file: TFile) => Uint8Array.from(await readFile(this.path(file.path))).buffer,
        getResourcePath: (file: TFile) => file.path,
        createFolder: (path: string) => {
          const created = this.folderCreates.then(async () => {
            if (this.files.has(path)) throw new Error("Folder already exists");
            await this.addFolder(path);
          });
          this.folderCreates = created.catch(() => {});
          return created;
        },
        create: async (path: string, content: string) => { if (this.failCreate) throw new Error("disk full"); return this.addFile(path, content); },
        createBinary: async (path: string, content: ArrayBuffer) => { if (this.failCreate) throw new Error("disk full"); return this.addFile(path, new Uint8Array(content)); },
        process: async (file: TFile, callback: (data: string) => string) => {
          await this.beforeProcess?.(); this.beforeProcess = undefined;
          const next = callback(await this.read(file.path));
          await writeFile(this.path(file.path), next); await this.updateStat(file);
          this.mutations.push(`write:${file.path}`); return next;
        },
      },
      metadataCache: {
        getFileCache: (file: TFile) => this.cache(file),
        getFirstLinkpathDest: (link: string, from: string) => this.resolveLink(link, from),
        fileToLinktext: (file: TFile, sourcePath: string) => posix.relative(posix.dirname(sourcePath), file.path).replace(/\.md$/i, ""),
      },
      fileManager: {
        processFrontMatter: async (file: TFile, callback: (frontmatter: Record<string, unknown>) => void) => {
          await this.beforeProcess?.(); this.beforeProcess = undefined;
          const current = await this.read(file.path);
          const header = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(current);
          if (!header) throw new Error(`Missing frontmatter in ${file.path}.`);
          const parsed = parseYaml(header[1]!);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Invalid frontmatter in ${file.path}.`);
          const properties = parsed as Record<string, unknown>;
          const before = JSON.stringify(properties);
          callback(properties);
          if (JSON.stringify(properties) === before) return;
          const newline = current.includes("\r\n") ? "\r\n" : "\n";
          const next = `${current.startsWith("\uFEFF") ? "\uFEFF" : ""}---${newline}${stringifyYaml(properties).trimEnd().replace(/\r?\n/g, newline)}${newline}---${newline}${current.slice(header[0].length)}`;
          await writeFile(this.path(file.path), next); await this.updateStat(file);
          this.mutations.push(`write:${file.path}`);
        },
        generateMarkdownLink: (file: TFile, sourcePath: string, subpath = "", alias = "") => {
          const target = posix.relative(posix.dirname(sourcePath), file.path);
          return `[${alias || file.basename}](<${target}${subpath}>)`;
        },
        renameFile: async (file: TFile | TFolder, destination: string) => {
          if (this.failRename) throw new Error("simulated interruption before rename");
          if (this.files.has(destination)) throw new Error("destination exists");
          const old = file.path;
          await rename(this.path(old), this.path(destination));
          if (file instanceof TFolder) {
            const moved = [...this.files.entries()].filter(([path]) => path === old || path.startsWith(`${old}/`));
            for (const [path] of moved) this.files.delete(path);
            for (const [path, entry] of moved) {
              entry.path = destination + path.slice(old.length);
              this.files.set(entry.path, entry);
            }
          } else {
            this.files.delete(old); file.path = destination; this.files.set(destination, file);
          }
          this.index.rename(destination, old); this.mutations.push(`rename:${old}:${destination}`);
        },
        trashFile: async (file: TFile) => {
          const destination = this.path(`.trash/${file.path}`);
          await mkdir(dirname(destination), { recursive: true });
          await rename(this.path(file.path), destination);
          this.files.delete(file.path); this.index.remove(file.path); this.mutations.push(`trash:${file.path}`);
        },
      },
    };
    this.app = app as unknown as App;
    this.index = new EmberlyVaultIndex(this.app);
  }
  path(path: string): string {
    const absolute = resolve(this.root, path);
    if (!absolute.startsWith(this.root + sep)) throw new Error("Fixture path escaped isolated directory");
    return absolute;
  }
  async read(path: string): Promise<string> { return readFile(this.path(path), "utf8"); }
  async addFolder(path: string): Promise<void> {
    if (this.files.has(path)) return;
    const parent = posix.dirname(path) === "." ? "" : posix.dirname(path);
    if (parent) await this.addFolder(parent);
    await mkdir(this.path(path), { recursive: true });
    const directory = new TFolder(path); this.files.set(path, directory);
    (this.files.get(parent) as TFolder).children.push(directory);
  }
  async addFile(path: string, content: string | Uint8Array): Promise<TFile> {
    const parent = posix.dirname(path) === "." ? "" : posix.dirname(path);
    await this.addFolder(parent);
    await writeFile(this.path(path), content, { flag: "wx" });
    const file = new TFile(path); await this.updateStat(file); this.files.set(path, file);
    (this.files.get(parent) as TFolder).children.push(file);
    if (path.endsWith(".md") && typeof content === "string") this.index.setContent(path, content);
    this.mutations.push(`create:${path}`); return file;
  }
  private async updateStat(file: TFile): Promise<void> {
    const info = await stat(this.path(file.path)); file.stat = { mtime: info.mtimeMs, ctime: info.ctimeMs, size: info.size };
  }
  resolveLink(link: string, from: string): TFile | undefined {
    const decoded = decodeURIComponent(link.split("#")[0]!);
    const paths = [decoded, posix.normalize(posix.join(posix.dirname(from), decoded))].flatMap((path) => [path, path + ".md"]);
    for (const path of paths) { const file = this.files.get(path); if (file instanceof TFile) return file; }
    const matches = [...this.files.values()].filter((file): file is TFile => file instanceof TFile && (file.name === decoded || file.basename === decoded));
    return matches.length === 1 ? matches[0] : undefined;
  }
  cache(file: TFile): CachedMetadata {
    const content = readFileSync(this.path(file.path), "utf8"), header = /^---\n([\s\S]*?)\n---\n/.exec(content);
    const links: unknown[] = [], embeds: unknown[] = [];
    const expression = /!?\[\[([^\]]+)\]\]|!?\[([^\]]*)\]\(<?([^)>]+)>?\)/g;
    for (const match of content.matchAll(expression)) {
      if (match.index! < (header?.[0].length ?? 0)) continue;
      const link = match[1]?.split("|")[0] ?? match[3]!;
      if (/^https?:/.test(link)) continue;
      const ref = { link, original: match[0], displayText: match[1]?.split("|")[1] ?? match[2], position: {
        start: { offset: match.index! + (this.staleCache ? 1 : 0) }, end: { offset: match.index! + match[0].length },
      }};
      (match[0].startsWith("!") ? embeds : links).push(ref);
    }
    const properties = header ? parseYaml(header[1]!) : {};
    const frontmatterLinks: { key: string; link: string; original: string; displayText?: string }[] = [];
    const collect = (value: unknown, key: string): void => {
      if (typeof value === "string") {
        for (const match of value.matchAll(/\[\[([^\]]+)\]\]/g)) {
          const [link, displayText] = match[1]!.split("|");
          frontmatterLinks.push({ key, link: link!, original: match[0], displayText });
        }
      } else if (Array.isArray(value)) value.forEach((item, index) => collect(item, `${key}.${index}`));
      else if (value && typeof value === "object") Object.entries(value).forEach(([name, item]) => collect(item, key ? `${key}.${name}` : name));
    };
    collect(properties, "");
    return { frontmatter: properties, links, embeds, frontmatterLinks } as CachedMetadata;
  }
  async seed(): Promise<void> {
    for (const map of ["a", "b"]) {
      await this.addFile(`${map}/Map.md`, note({ emberly: "map", "emberly-format": 2, "emberly-id": map, "emberly-root-id": `${map}-root`, "emberly-layout": "center" },
        "# Root notes\n"));
      for (const topic of ["one", "two"]) await this.addFile(`${map}/Topics/${topic}.md`, note({
        emberly: "topic", "emberly-format": 2, "emberly-id": `${map}-${topic}`, "emberly-map": map,
        "emberly-parent": topic === "one" ? `${map}-root` : `${map}-one`,
        "emberly-parent-link": topic === "one" ? "[[../Map]]" : "[[one]]", "emberly-order": "a0",
        "emberly-state": 8,
      }));
    }
    await this.addFile("a/Resources/Guide.md", note({ emberly: "resource", "emberly-format": 2, "emberly-id": "resource", "emberly-map": "a", "emberly-topic": "a-one", "emberly-topic-link": "[[../Topics/one]]", "emberly-order": 1, "emberly-kind": "note", title: "Guide", tags: ["research"], custom: { keep: true } }, "# Guide\n\nKeep this content.\n"));
    this.mutations.length = 0;
  }
  get resource() { return this.index.resourceCatalog().resources.find((item) => item.id === "resource")!; }
  target(map: string, topic: string) { return { file: this.files.get(`${map}/Topics/${topic}.md`) as unknown as ObsidianFile, id: `${map}-${topic}`, mapId: map }; }
  mover(): ResourceMoves { return new ResourceMoves(this.app, this.index, async (plan) => { this.pending = plan; }, () => {}); }
  async dispose(): Promise<void> {
    const temporary = resolve(tmpdir());
    if (!this.root.startsWith(temporary + sep) || !this.root.slice(temporary.length + 1).startsWith("emberly-resource-test-")) throw new Error("Unsafe test cleanup");
    await rm(this.root, { recursive: true, force: true });
  }
  static async create(): Promise<ResourceFixture> {
    const fixture = new ResourceFixture(await mkdtemp(resolve(tmpdir(), "emberly-resource-test-")));
    await fixture.seed(); return fixture;
  }
}
