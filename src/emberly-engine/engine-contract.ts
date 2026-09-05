import type { MarkdownNodeEntity } from "./adapter/markdown-collection";

/** The subset of the preserved JavaScript renderer used by the Obsidian host. */
export interface EngineNode {
  id: string;
  isRoot: boolean;
  children: EngineNode[];
  entity: MarkdownNodeEntity;
  setIsCollapsed(value: boolean): void;
  render(): void;
}

export interface EngineRenderer {
  resize(width: number, height: number): void;
  destroy(removeView: boolean): void;
}

export interface EngineViewport { resize(width: number, height: number): void; }

export interface EngineTree {
  root: EngineNode | null;
  running: boolean;
  isLoaded: boolean;
  instanceId: string;
  nodeEventHandler: { activeNodeId: string | null; setActiveNodeId(id: string): void };
  linkRenderer: {
    nodeId: string | null;
    waitingNodeIds: string[] | null;
    clear(): void;
    setLinkedNodes(ids: string[], source: string): void;
  };
  on(event: "onActiveNodeChanged", callback: (id: string | null) => void): void;
  on(event: "onNodeFocused" | "onRootFocused" | "onNodeEdit", callback: (node: EngineNode) => void): void;
  on(event: "onLoad", callback: () => void): void;
  getNodeById(id: string): EngineNode | null;
  setDragEnabled(enabled: boolean): void;
  setTickDirty(): void;
  migrateWindow(): void;
  panTo(node: EngineNode, x?: number, y?: number, fit?: boolean): void;
  zoom(direction: number): void;
  destroy(): void;
}
