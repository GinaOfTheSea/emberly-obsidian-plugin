import { describe, expect, it, vi } from "vitest";
import type { MetadataCache, TFile } from "obsidian";
import { RESOURCE_TOPIC_LINK_PROPERTY, resourceTopicLink } from "../../src/resources/resource-topic-link";

describe("resource owner graph link", () => {
  it("uses Obsidian's source-relative link text and remains a derived property", () => {
    const fileToLinktext = vi.fn(() => "../Topics/Research");
    const metadata = { fileToLinktext } as unknown as MetadataCache;
    const topic = { path: "Map/Topics/Research.md" } as TFile;

    expect(RESOURCE_TOPIC_LINK_PROPERTY).toBe("emberly-topic-link");
    expect(resourceTopicLink(metadata, "Map/Resources/Paper.md", topic)).toBe("[[../Topics/Research]]");
    expect(fileToLinktext).toHaveBeenCalledWith(topic, "Map/Resources/Paper.md", true);
  });

  it("rejects an unsafe or missing native link", () => {
    const topic = {} as TFile;
    expect(() => resourceTopicLink({ fileToLinktext: () => "" } as unknown as MetadataCache, "r.md", topic)).toThrow(/safe resource owner link/);
    expect(() => resourceTopicLink({ fileToLinktext: () => "bad\nlink" } as unknown as MetadataCache, "r.md", topic)).toThrow(/safe resource owner link/);
  });
});
