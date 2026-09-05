import type { App, TFile } from "obsidian";
import { RESOURCE_TOPIC_LINK_PROPERTY, resourceTopicLink } from "../resources/resource-topic-link";
import { TOPIC_PARENT_LINK_PROPERTY, topicParentLink } from "../topics/topic-parent-link";
import type { EmberlyVaultIndex } from "./vault-index";

type PropertyUpdate = (properties: Record<string, unknown>) => Record<string, unknown>;

export interface GraphLinkCoordinatorHost {
  app: App;
  vaultIndex(): EmberlyVaultIndex;
  stopped(): boolean;
  queueMapWrite(mapId: string, action: () => Promise<void>): Promise<void>;
  updateProperties(file: TFile, update: PropertyUpdate): Promise<Record<string, unknown>>;
}

/** Maintains graph-only parent/owner links without treating them as hierarchy. */
export class GraphLinkCoordinator {
  private timer?: number;
  private readonly pendingMaps = new Set<string>();

  constructor(private readonly host: GraphLinkCoordinatorHost) {}

  mapNeedingRepair(file: TFile, properties: Record<string, unknown>): string | undefined {
    const mapId = properties["emberly-map"], id = properties["emberly-id"];
    if (properties["emberly-format"] !== 2 || typeof mapId !== "string" || typeof id !== "string") return undefined;
    const vaultIndex = this.host.vaultIndex();
    const matches = vaultIndex.maps().filter((map) => map.id === mapId), map = matches[0];
    if (matches.length !== 1 || !map || map.format !== 2 || map.issues.length) return undefined;
    try {
      if (properties.emberly === "topic") {
        const node = map.nodes.find((candidate) => candidate.id === id && candidate.path === file.path);
        const parent = node?.parentId ? map.nodes.find((candidate) => candidate.id === node.parentId) : undefined;
        const parentFile = parent && vaultIndex.file(parent.path);
        if (!node || !parent || !parentFile) return undefined;
        return properties[TOPIC_PARENT_LINK_PROPERTY] === topicParentLink(this.host.app.metadataCache, file.path, parentFile)
          ? undefined : map.id;
      }
      if (properties.emberly === "resource") {
        const resources = vaultIndex.resourceCatalog().resources.filter((resource) => resource.path === file.path
          && resource.id === id && resource.mapId === mapId);
        const owner = resources.length === 1 ? map.nodes.find((node) => node.id === resources[0]!.topicId && node.parentId) : undefined;
        const ownerFile = owner && vaultIndex.file(owner.path);
        if (!owner || !ownerFile) return undefined;
        return properties[RESOURCE_TOPIC_LINK_PROPERTY] === resourceTopicLink(this.host.app.metadataCache, file.path, ownerFile)
          ? undefined : map.id;
      }
      return undefined;
    } catch { return undefined; }
  }

  schedule(ids?: Iterable<string>): void {
    if (this.host.stopped()) return;
    if (ids) {
      for (const id of ids) if (id) this.pendingMaps.add(id);
    } else {
      for (const map of this.host.vaultIndex().maps()) if (map.format === 2) this.pendingMaps.add(map.id);
    }
    if (!this.pendingMaps.size || this.timer !== undefined) return;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      const pending = [...this.pendingMaps];
      this.pendingMaps.clear();
      for (const id of pending) void this.host.queueMapWrite(id, () => this.reconcile(id)).catch((error) => {
        if (!this.host.stopped()) console.error(`Could not update graph links for Emberly map ${id}`, error);
      });
    }, 200);
  }

  async reconcile(mapId: string): Promise<void> {
    if (this.host.stopped()) return;
    const { app } = this.host;
    const vaultIndex = this.host.vaultIndex();
    const matches = vaultIndex.maps().filter((map) => map.id === mapId), map = matches[0];
    if (matches.length !== 1 || !map || map.format !== 2 || map.issues.length || !vaultIndex.hierarchySettled(mapId)) return;
    for (const node of map.nodes) {
      if (this.host.stopped() || !node.parentId) continue;
      const file = vaultIndex.file(node.path), parent = map.nodes.find((candidate) => candidate.id === node.parentId);
      const parentFile = parent && vaultIndex.file(parent.path);
      if (!file || !parent || !parentFile) return;
      const expected = topicParentLink(app.metadataCache, file.path, parentFile);
      if (vaultIndex.propertiesFor(file)[TOPIC_PARENT_LINK_PROPERTY] === expected) continue;
      await this.host.updateProperties(file, (properties) => {
        const latestMaps = vaultIndex.maps().filter((candidate) => candidate.id === mapId), latest = latestMaps[0];
        const latestNode = latest?.nodes.find((candidate) => candidate.id === node.id && candidate.path === file.path);
        const latestParent = latestNode?.parentId ? latest?.nodes.find((candidate) => candidate.id === latestNode.parentId) : undefined;
        const latestParentFile = latestParent && vaultIndex.file(latestParent.path);
        if (latestMaps.length !== 1 || !latest || latest.format !== 2 || latest.issues.length || !latestNode || !latestParent || !latestParentFile
          || properties.emberly !== "topic" || properties["emberly-format"] !== 2
          || properties["emberly-id"] !== latestNode.id || properties["emberly-map"] !== mapId
          || properties["emberly-parent"] !== latestParent.id) {
          throw new Error("The topic hierarchy changed while its graph link was being updated.");
        }
        return { [TOPIC_PARENT_LINK_PROPERTY]: topicParentLink(app.metadataCache, file.path, latestParentFile) };
      });
    }
    const resources = vaultIndex.resourceCatalog().resources.filter((resource) => resource.mapId === mapId);
    for (const resource of resources) {
      if (this.host.stopped()) return;
      const file = vaultIndex.file(resource.path), owner = map.nodes.find((node) => node.id === resource.topicId && node.parentId);
      const ownerFile = owner && vaultIndex.file(owner.path);
      if (!file || !owner || !ownerFile) return;
      const expected = resourceTopicLink(app.metadataCache, file.path, ownerFile);
      if (vaultIndex.propertiesFor(file)[RESOURCE_TOPIC_LINK_PROPERTY] === expected) continue;
      await this.host.updateProperties(file, (properties) => {
        const latestMaps = vaultIndex.maps().filter((candidate) => candidate.id === mapId), latest = latestMaps[0];
        const latestResources = vaultIndex.resourceCatalog().resources.filter((candidate) => candidate.id === resource.id
          && candidate.path === file.path && candidate.mapId === mapId);
        const latestResource = latestResources[0];
        const latestOwner = latestResource && latest?.nodes.find((node) => node.id === latestResource.topicId && node.parentId);
        const latestOwnerFile = latestOwner && vaultIndex.file(latestOwner.path);
        if (latestMaps.length !== 1 || !latest || latest.format !== 2 || latest.issues.length
          || latestResources.length !== 1 || !latestResource || !latestOwner || !latestOwnerFile
          || properties.emberly !== "resource" || properties["emberly-format"] !== 2
          || properties["emberly-id"] !== latestResource.id || properties["emberly-map"] !== mapId
          || properties["emberly-topic"] !== latestOwner.id) {
          throw new Error("The resource ownership changed while its graph link was being updated.");
        }
        return { [RESOURCE_TOPIC_LINK_PROPERTY]: resourceTopicLink(app.metadataCache, file.path, latestOwnerFile) };
      });
    }
  }

  dispose(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.pendingMaps.clear();
  }
}
