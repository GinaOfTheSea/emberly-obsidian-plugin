import type { MetadataCache, TFile } from "obsidian";

/** Derived Obsidian-native graph edge. Hierarchy remains ID-backed. */
export const TOPIC_PARENT_LINK_PROPERTY = "emberly-parent-link";

export function topicParentLink(metadata: MetadataCache, sourcePath: string, parent: TFile): string {
  const linktext = metadata.fileToLinktext(parent, sourcePath, true);
  if (!linktext || /[\r\n]/.test(linktext)) throw new Error("Obsidian could not create a safe parent link.");
  return `[[${linktext}]]`;
}
