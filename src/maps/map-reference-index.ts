import { parseLinktext, type CachedMetadata, type MetadataCache } from "obsidian";
import type { EmberlyMap } from "../shared/types";
import type { OwnedResource } from "../resources/resource-catalog";

export interface MapReferenceSelection { sourceNodeId: string; targetNodeIds: string[]; }
interface Endpoint { mapPath: string; nodeId: string; root: boolean; }

/** Derived note-to-note edges. Ownership is projected only when selecting a note,
 * so a topic never inherits the outgoing links/backlinks of its resources. */
export class MapReferenceIndex {
  private endpoints = new Map<string, Endpoint>();
  private readonly outgoing = new Map<string, Set<string>>();
  private readonly incoming = new Map<string, Set<string>>();
  private readonly unresolvedSources = new Set<string>();

  syncOwnership(maps: EmberlyMap[], resources: OwnedResource[]): string[] {
    const endpoints = new Map<string, Endpoint>();
    const ambiguous = new Set<string>();
    const add = (path: string, endpoint: Endpoint): void => {
      if (endpoints.has(path) || ambiguous.has(path)) { endpoints.delete(path); ambiguous.add(path); }
      else endpoints.set(path, endpoint);
    };
    const counts = new Map<string, number>();
    for (const map of maps) counts.set(map.id, (counts.get(map.id) ?? 0) + 1);
    const valid = maps.filter((map) => !map.issues.length && counts.get(map.id) === 1);
    for (const map of valid) {
      for (const node of map.nodes) {
        // Outline documents are never sources, even in a malformed old export.
        if (node.path !== map.path) add(node.path, { mapPath: map.path, nodeId: node.id, root: !node.parentId });
      }
    }
    for (const resource of resources) {
      const map = valid.find((map) => map.id === resource.mapId);
      const owner = map?.nodes.find((node) => node.id === resource.topicId);
      if (map && owner) add(resource.path, { mapPath: map.path, nodeId: owner.id, root: !owner.parentId });
    }
    const added = [...endpoints.keys()].filter((path) => !this.endpoints.has(path));
    this.endpoints = endpoints;
    for (const path of this.outgoing.keys()) if (!endpoints.has(path)) this.replace(path, new Set());
    for (const path of this.unresolvedSources) if (!endpoints.has(path)) this.unresolvedSources.delete(path);
    return added;
  }

  paths(): string[] { return [...this.endpoints.keys()]; }
  pendingResolution(): string[] { return [...this.unresolvedSources]; }

  update(path: string, cache: CachedMetadata | null, resolve: MetadataCache["getFirstLinkpathDest"]): void {
    const targets = new Set<string>();
    this.unresolvedSources.delete(path);
    if (this.endpoints.has(path)) {
      // Public body caches deliberately exclude frontmatterLinks and mentions.
      for (const ref of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref.link)) continue;
        const linkpath = parseLinktext(ref.link).path;
        const target = linkpath ? resolve(linkpath, path) : { path };
        if (target) targets.add(target.path);
        else this.unresolvedSources.add(path);
      }
    }
    this.replace(path, targets);
  }

  selection(mapPath: string, path: string): MapReferenceSelection | null {
    const source = this.endpoints.get(path);
    if (!source || source.mapPath !== mapPath) return null;
    const targets = new Set<string>();
    for (const other of [...(this.outgoing.get(path) ?? []), ...(this.incoming.get(path) ?? [])]) {
      const destination = this.endpoints.get(other);
      if (destination && destination.mapPath === mapPath && !destination.root && destination.nodeId !== source.nodeId) {
        targets.add(destination.nodeId);
      }
    }
    return { sourceNodeId: source.nodeId, targetNodeIds: [...targets].sort() };
  }

  clear(): void { this.endpoints.clear(); this.outgoing.clear(); this.incoming.clear(); this.unresolvedSources.clear(); }

  private replace(path: string, next: Set<string>): void {
    const previous = this.outgoing.get(path);
    if (previous?.size === next.size && [...next].every((target) => previous.has(target))) return;
    for (const target of previous ?? []) {
      const sources = this.incoming.get(target);
      sources?.delete(path);
      if (!sources?.size) this.incoming.delete(target);
    }
    if (!next.size) this.outgoing.delete(path);
    else this.outgoing.set(path, next);
    for (const target of next) {
      let sources = this.incoming.get(target);
      if (!sources) this.incoming.set(target, sources = new Set());
      sources.add(path);
    }
  }
}
