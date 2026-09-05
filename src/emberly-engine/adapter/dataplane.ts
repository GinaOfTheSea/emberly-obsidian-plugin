import { compareOrder } from "../../topics/topic-hierarchy";

export class Entity {
  static Compare(this: void, a: { index: number | string }, b: { index: number | string }): number {
    return compareOrder(a.index, b.index);
  }
}

export class Debounce<T = unknown> {
  private result: T | null = null;
  private counter = 0;
  constructor(private readonly skip: number) {}
  debounce(method: () => T): T | null {
    if (this.counter++ % this.skip === 0) this.result = method();
    return this.result;
  }
  clear(): void { this.result = null; this.counter = 0; }
}

interface TreeEntity { id: string; parentId: string | null; index: number | string; depth: number; }

export class TreeHelper {
  static GetOrderedTreeByReference(nodeData: TreeEntity[]): TreeEntity[] {
    const byId = new Map(nodeData.map((node) => [node.id, node]));
    const root = nodeData.find((node) => !node.parentId);
    if (!root) return [];
    const children = new Map<string, TreeEntity[]>();
    for (const node of nodeData) {
      if (node === root) continue;
      const parentId = node.parentId && byId.has(node.parentId) ? node.parentId : root.id;
      children.set(parentId, [...(children.get(parentId) ?? []), node]);
    }
    const result: TreeEntity[] = [];
    const queue = [root];
    while (queue.length) {
      const node = queue.shift();
      if (!node) break;
      result.push(node);
      queue.push(...(children.get(node.id) ?? []).sort(Entity.Compare));
    }
    return result;
  }
}
