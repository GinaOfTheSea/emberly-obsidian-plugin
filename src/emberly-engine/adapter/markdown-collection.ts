import { generateKeyBetween } from "../../topics/fractions";
import { compareOrder } from "../../topics/topic-hierarchy";
import EventEmitter from "events";
import type { EmberlyMap, EmberlyNode } from "../../shared/types";
import type { TopicAppearance } from "../../topics/topic-appearance";
import { mapCenterName } from "../../maps/map-center";

export interface EngineEntitySnapshot {
  id: string;
  sourcePath: string;
  parentId: string | null;
  parentName: string | null;
  name: string;
  index: number | string;
  depth: number;
  side: number;
  color: number;
  isCollapsed: boolean;
  rating: number;
  state: number;
  changed?: string[];
  previousParentId?: string | null;
  previousIndex?: number | string;
  previousSiblingId?: string | null;
  nextSiblingId?: string | null;
}

type Persist = (snapshot: EngineEntitySnapshot) => void | Promise<void>;
type EntityUpdateOptions = { sync?: boolean; instanceId?: string | null };

class Connections extends EventEmitter {
  hasConnections(): boolean { return false; }
  setActiveInput(): boolean { return true; }
  blurActiveInput(): void {}
}

class EngineContext extends EventEmitter {
  private readonly connections = new Connections();
  constructor(private readonly avatarUrl: string) { super(); }
  async getOwnerProfile(): Promise<{ avatarUrl: string }> { return { avatarUrl: this.avatarUrl }; }
  getConnections(): Connections { return this.connections; }
  canEdit(): boolean { return true; }
  send(): void {}
}

export class MarkdownNodeEntity {
  id: string;
  parentId: string | null;
  name: string;
  state: number;
  centerName?: string;
  iconFilter?: number;
  rating: number;
  index: number | string;
  depth: number;
  side: number;
  color: number;
  isCollapsed: boolean;
  path: string[] = [];
  sourcePath: string;
  created = new Date().toISOString();
  lastModified = new Date().toISOString();

  constructor(private readonly collection: MarkdownNodeCollection, node: EmberlyNode, depth: number) {
    this.id = node.id;
    this.parentId = node.parentId;
    this.name = node.title;
    this.state = node.state;
    this.rating = node.rating;
    this.index = node.order;
    this.depth = depth;
    this.side = node.side === "left" ? -1 : node.side === "center" ? 0 : 1;
    this.color = node.color;
    this.isCollapsed = node.collapsed;
    this.sourcePath = node.path;
  }

  get isRoot(): boolean { return this.parentId === null; }
  get rgbColor(): number | null { return this.color >= 0 ? this.color : null; }
  update(event = "updated", options: { instanceId?: string | null } = {}): void { this.collection.onEntityEvent(event, this, options); }
  setName(value: string, options: EntityUpdateOptions = {}): void { if (this.name !== value) { this.name = value; this.sync(options); } }
  setState(value: number, options: EntityUpdateOptions = {}): void { if (this.state !== value) { this.state = value; this.sync(options); } }
  setRating(value: number, options: EntityUpdateOptions = {}): void { if (this.rating !== value) { this.rating = value; this.sync(options); } }
  setDepth(value: number, options: EntityUpdateOptions = {}): void { if (this.depth !== value) { this.depth = this.isRoot ? 0 : Math.max(1, value); this.sync(options); } }
  setSide(value: number, options: EntityUpdateOptions = {}): void { if (this.side !== value) { this.side = value; this.sync(options); } }
  setColor(value: number, options: EntityUpdateOptions = {}): void { if (this.color !== value) { this.color = value; this.sync(options); } }
  unsetColor(options: EntityUpdateOptions = {}): void { this.setColor(-1, options); }
  setIsCollapsed(value: boolean, options: EntityUpdateOptions = {}): void { if (this.isCollapsed !== value) { this.isCollapsed = value; this.sync(options); } }
  setPath(value: string[], options: EntityUpdateOptions = {}): void { this.path = value; this.sync(options); }
  setParentId(value: string, options: { sync?: boolean; refresh?: boolean; instanceId?: string | null } = {}): void {
    if (this.parentId === value) return;
    this.parentId = value;
    if (options.sync !== false) this.update("updated", options);
    else if (options.refresh) this.update("refresh", options);
  }
  setIndex(value: number | string, options: { sync?: boolean; instanceId?: string | null } = {}): void {
    if (this.index === value) return;
    this.index = value;
    if (options.sync !== false) this.update("updated", options);
  }
  placeBetween(previous?: MarkdownNodeEntity, next?: MarkdownNodeEntity, options: { sync?: boolean; instanceId?: string | null } = {}): void {
    const value = typeof this.index === "string"
      ? generateKeyBetween(previous ? String(previous.index) : null, next ? String(next.index) : null)
      : previous && next ? (Number(previous.index) + Number(next.index)) / 2 : previous ? Number(previous.index) + 1 : next ? Number(next.index) - 1 : 1;
    this.setIndex(value, options);
  }
  setFullTree(value: boolean): void { if (this.isRoot) this.setSide(value ? 0 : 1, { sync: false }); }
  setLearningState(value: number, options: EntityUpdateOptions = {}): void {
    const state = value === 0 ? this.state & 0b11111100 : value === 1 ? (this.state & 0b11111101) | 1 : (this.state & 0b11111110) | 2;
    this.setState(state, options);
  }
  hasNotes(): boolean { return Boolean(this.state & 0b1000); }
  hasResources(): boolean { return Boolean(this.state & 0b0100); }

  private sync(options: EntityUpdateOptions): void {
    if (options.sync !== false) this.update("updated", options);
  }
}

export class MarkdownNodeCollection {
  readonly context: EngineContext;
  readonly contextId: string;
  readonly externalEvents = new EventEmitter();
  readonly entityIndex: MarkdownNodeEntity[];
  private readonly entities: Map<string, MarkdownNodeEntity>;
  private writeQueue = Promise.resolve();
  private readonly observed = new Map<string, EngineEntitySnapshot>();

  constructor(map: EmberlyMap, private readonly persist: Persist, avatarUrl = "") {
    this.context = new EngineContext(avatarUrl);
    this.contextId = map.id;
    const byId = new Map(map.nodes.map((node) => [node.id, node]));
    const depth = (node: EmberlyNode): number => {
      let result = 0; let current: EmberlyNode | undefined = node; const seen = new Set<string>();
      while (current?.parentId && !seen.has(current.id)) { seen.add(current.id); result++; current = byId.get(current.parentId); }
      return result;
    };
    this.entityIndex = map.nodes.map((node) => new MarkdownNodeEntity(this, node, depth(node)));
    this.entities = new Map(this.entityIndex.map((entity) => [entity.id, entity]));
    const root = this.entityIndex.find((entity) => entity.isRoot);
    if (root) { root.centerName = mapCenterName(map); root.iconFilter = this.iconFilter(map); }
    for (const entity of this.entityIndex) this.observed.set(entity.id, this.snapshot(entity));
  }

  async loadEverything(): Promise<boolean> { return this.entityIndex.length > 0; }
  canEdit(): boolean { return true; }
  syncToRemote(): void {}
  getGlobalEventKey(event: string): string { return event; }
  getEntityById(id: string): MarkdownNodeEntity | undefined { return this.entities.get(id); }
  /** Compare live topology, including local drags/collapse before cache events arrive. */
  matchesStructure(map: EmberlyMap): boolean {
    if (map.id !== this.contextId || map.nodes.length !== this.entityIndex.length) return false;
    for (const node of map.nodes) {
      const entity = this.entities.get(node.id);
      const side = node.side === "left" ? -1 : node.side === "center" ? 0 : 1;
      if (!entity || entity.parentId !== node.parentId || entity.side !== side || entity.isCollapsed !== node.collapsed) return false;
    }
    // The live engine uses fractional indices; compare sibling order, not raw indices.
    const order = (nodes: { id: string; parentId: string | null; index: number | string }[]) => nodes
      .slice().sort((a, b) => (a.parentId ?? "").localeCompare(b.parentId ?? "") || compareOrder(a.index, b.index) || compareOrder(a.id, b.id))
      .map((node) => node.id).join("\n");
    return order(this.entityIndex) === order(map.nodes.map((node) => ({ ...node, index: node.order })));
  }
  /** Stable IDs survive native file/folder renames, including delayed cache events. */
  reconcileIdentity(node: EmberlyNode): void {
    const entity = this.entities.get(node.id);
    if (!entity) return;
    const changed = entity.name !== node.title;
    entity.name = node.title;
    entity.sourcePath = node.path;
    const observed = this.observed.get(node.id);
    if (observed) this.observed.set(node.id, { ...observed, name: node.title, sourcePath: node.path });
    if (changed) this.externalEvents.emit("updated", entity, null);
  }
  applyMapCenter(map: EmberlyMap): void {
    if (map.id !== this.contextId) return;
    const root = this.entityIndex.find((entity) => entity.isRoot);
    const name = mapCenterName(map);
    const filter = this.iconFilter(map);
    if (!root || (root.centerName === name && root.iconFilter === filter)) return;
    root.centerName = name;
    root.iconFilter = filter;
    this.externalEvents.emit("updated", root, null);
  }
  private iconFilter(map: EmberlyMap): number {
    return (map.showIcons?.notes !== false ? 8 : 0) | (map.showIcons?.resources !== false ? 4 : 0);
  }
  /** Reflect an already-saved appearance edit without another persistence event. */
  applyAppearance(id: string, appearance: Partial<TopicAppearance>): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    const observed = this.observed.get(id);
    for (const field of ["color", "rating", "state"] as const) {
      const value = appearance[field];
      if (value === undefined) continue;
      entity[field] = value;
    }
    // Observed snapshots may also be queued for persistence; don't mutate one.
    if (observed) this.observed.set(id, { ...observed, ...appearance });
    this.externalEvents.emit("updated", entity, null);
  }
  addNode(node: EmberlyNode): MarkdownNodeEntity | undefined {
    if (this.entities.has(node.id)) return undefined;
    let depth = 0;
    let parentId = node.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      depth++;
      parentId = this.entities.get(parentId)?.parentId ?? null;
    }
    const entity = new MarkdownNodeEntity(this, node, depth);
    // Modern topics already carry their durable fractional key.
    if (typeof node.order === "number") {
      const siblings = this.entityIndex.filter((candidate) => candidate.parentId === node.parentId);
      if (siblings.length) entity.index = Math.max(...siblings.map((candidate) => Number(candidate.index))) + 1;
    }
    this.entityIndex.push(entity);
    this.entities.set(entity.id, entity);
    this.observed.set(entity.id, this.snapshot(entity));
    this.externalEvents.emit("created", entity, null);
    return entity;
  }
  snapshot(entity: MarkdownNodeEntity): EngineEntitySnapshot {
    const siblings = this.entityIndex.filter((candidate) => candidate.parentId === entity.parentId)
      .sort((a, b) => compareOrder(a.index, b.index) || compareOrder(a.id, b.id));
    const at = siblings.indexOf(entity);
    return { id: entity.id, sourcePath: entity.sourcePath, parentId: entity.parentId,
      previousSiblingId: siblings[at - 1]?.id ?? null, nextSiblingId: siblings[at + 1]?.id ?? null,
      parentName: entity.parentId ? this.entities.get(entity.parentId)?.name ?? null : null,
      name: entity.name, index: entity.index, depth: entity.depth, side: entity.side,
      color: entity.color, isCollapsed: entity.isCollapsed, rating: entity.rating, state: entity.state };
  }
  onEntityEvent(event: string, entity: MarkdownNodeEntity, options: { instanceId?: string | null }): void {
    if (event === "refresh") return;
    const snapshot = this.snapshot(entity);
    const before = this.observed.get(entity.id);
    snapshot.previousParentId = before?.parentId;
    snapshot.previousIndex = before?.index;
    snapshot.changed = (["parentId", "index", "name", "side", "color", "isCollapsed", "rating", "state"] as const)
      .filter((field) => !before || before[field] !== snapshot[field]);
    this.observed.set(entity.id, snapshot);
    this.writeQueue = this.writeQueue.then(() => this.persist(snapshot)).catch((error) => console.error("Emberly Markdown write failed", error));
    this.externalEvents.emit("updated", entity, options.instanceId ?? null);
  }
}
