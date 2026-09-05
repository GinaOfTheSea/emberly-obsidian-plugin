import type { App, TFile } from "obsidian";
import type { EmberlyVaultIndex } from "./vault-index";
import type { LocalWriteGuard } from "./local-write-guard";
import { leanTopicProperties } from "./note-metadata";

export type PropertyUpdate = Record<string, unknown>
  | ((properties: Record<string, unknown>) => Record<string, unknown>);

/** Applies Emberly metadata through Obsidian's supported frontmatter API. */
export class FrontmatterEditor {
  constructor(
    private readonly app: App,
    private readonly index: () => EmberlyVaultIndex,
    private readonly localWrites: LocalWriteGuard,
  ) {}

  async update(file: TFile, update: PropertyUpdate, root = false): Promise<Record<string, unknown>> {
    let saved: Record<string, unknown> = {};
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        const value: unknown = frontmatter;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error(`Invalid frontmatter in ${file.path}.`);
        }
        const properties = value as Record<string, unknown>;
        const updates = typeof update === "function" ? update(properties) : update;
        saved = leanTopicProperties({ ...properties, ...updates }, root);
        for (const [key, value] of Object.entries(saved)) if (value === undefined) Reflect.deleteProperty(saved, key);
        for (const key of Object.keys(properties)) if (!(key in saved)) Reflect.deleteProperty(properties, key);
        Object.assign(properties, saved);
        this.localWrites.expectProperties(file.path, saved);
      });
      const content = await this.app.vault.cachedRead(file);
      this.index().setContent(file.path, content);
      return saved;
    } catch (error) {
      this.localWrites.forget(file.path);
      throw error;
    }
  }
}
