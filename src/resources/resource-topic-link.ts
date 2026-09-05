import type { MetadataCache, TFile } from "obsidian";

/** Derived Obsidian-native graph edge. Resource ownership remains ID-backed. */
export const RESOURCE_TOPIC_LINK_PROPERTY = "emberly-topic-link";

export function resourceTopicLink(metadata: MetadataCache, sourcePath: string, topic: TFile): string {
  const linktext = metadata.fileToLinktext(topic, sourcePath, true);
  if (!linktext || /[\r\n]/.test(linktext)) throw new Error("Obsidian could not create a safe resource owner link.");
  return `[[${linktext}]]`;
}
