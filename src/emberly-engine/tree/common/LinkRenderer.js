import { Graphics } from "../pixi";

export default class LinkRenderer {

  constructor(tree) {
    this.tree = tree;
    this.container = new Graphics();
    this.nodeId = null;
    this.node = null;
    this.noteId = null;
    this.waitingNodeIds = null;
    this.targetNodeIds = [];
    this.targetNodes = [];
    this.targetNodeIdSet = new Set();
    this.linkColor = 0xDADCE0;
    this.synapseColor = 0xD3D3DA;
    this.onParentOrReferencesUpdated = null;
    this.onResourcesUpdated = null;
  }

  clear() {
    this.waitingNodeIds = null;
    this.node = null;
    this.nodeId = null;
    this.targetNodeIdSet?.clear();
    this.targetNodeIds = [];
    this.targetNodes.forEach(n => n.render());
    this.targetNodes = [];
    this.container?.clear();
  }

  destroy() {
    this.container.clear();
    this.container.destroy();

    this.node = null;
    this.nodeId = null;
    this.targetNodes = null;
    this.targetNodeIds = null;
    this.targetNodeIdSet = null;
    this.container = null;
  }

  onLoaded() {
    if (this.waitingNodeIds !== null) {
      this.setLinkedNodes(this.waitingNodeIds);
      this.waitingNodeIds = null;
    }
  }

  onNodeCreated(nodeId) {
    if (this.targetNodeIdSet.has(nodeId)) {
      this.targetNodes = this.targetNodeIds.map(id => this.tree.getNodeById(id)).filter(n => n !== null);
      this.targetNodes.forEach(n => n.render());
      this.render();
    }
  }

  setLinkedNodes(nodeIds, selectedNodeId = null) {

    if (!this.tree.isLoaded) {
      this.waitingNodeIds = nodeIds;
      return false;
    } else if (!this.tree.running) {
      return false;
    } 

    const newTargetNodeIdSet = new Set(nodeIds);
    const activeNodeId = this.tree.nodeEventHandler.activeNodeId;

    if (!!selectedNodeId && activeNodeId !== selectedNodeId) {
      return false;
    }

    if (!this.compareSets(newTargetNodeIdSet, this.targetNodeIdSet) || this.nodeId !== activeNodeId) {
      this.targetNodeIdSet.clear();
      this.targetNodes.forEach(n => n.render());
      
      this.targetNodeIdSet = newTargetNodeIdSet;
      
      this.nodeId = activeNodeId;
      
      if (!!this.nodeId) {
        this.targetNodeIds = [...this.targetNodeIdSet].filter(n => n !== this.nodeId);
        this.node = this.tree.getNodeById(this.nodeId) || (this.tree.root?.id === this.nodeId ? this.tree.root : null);
        this.targetNodes = this.targetNodeIds.map(id => this.tree.getNodeById(id)).filter(n => n !== null);
        this.targetNodes.forEach(n => n.render());
      }
      
      this.render();
      this.tree.setTickDirty();
    }

    return true;
  }

  compareSets(a, b) {
    return a.size === b.size && [...a].every(value => b.has(value));
  }

  // TODO require massive cleanup of this crap.
  // TODO in render node, fetch generated color from linkrenderer.
  render() {
    const g = this.container;

    g.clear();

    if (this.hasActiveNode()) {
      const node = this.node;
      const height = node.height;
      const height05 = height / 2;
      const x = node.container.x - (node.isCollapsed && !node.isRoot ? node.getTextStyle().fontSize * 1.125 * node.side : 0);
      const y = node.container.y;
      g.x = x;
      g.y = y;

      g.lineStyle(15, this.synapseColor, 1, 0.5);

      for (let i = 0; i < this.targetNodeIds.length; i++) {

        let target = this.targetNodes[i];

        if (!target || target.isRoot) continue;

        if (!target.isVisible) {

          target = target.getFirstInvisibleParent().parent;
          const style = target.getTextStyle();

          const ty = target.container.y;
          const size = style.fontSize;
          const dy = ty - y;
          const absY = Math.abs(dy) * 0.5;
          const isCategory = target.depth === 1;

          const destX = target.container.x - x + target.side * (target.textOffsetX + target.renderText.textWidth - size * 1.07 + (isCategory && target.side === -1) * size * 0.1);
          const originY = Math.sign(dy - 0.001) * Math.min(height05, absY);

          g.moveTo(0, originY);
          this.bezierCurveTo(originY, destX + 1.5 * target.side, dy - 2, dy + 50, (height + target.height) / 2);
          g.drawCircle(destX + 1.5 * target.side, dy - 2, size * 0.09);

        } else {

          const offset = target.isCollapsed ? target.getTextStyle().fontSize * 1.125 * target.side : 0;
          const ty = target.container.y;
          const dy = ty - y;
          const absY = Math.abs(dy) * 0.5;
          const signY = Math.sign(dy + 0.001);
          const originY = signY * Math.min(height05, absY) * 0.8;
          const destX = target.container.x - x - offset;
          const destY = dy - signY * Math.min(target.height, absY) * 0.46;

          g.moveTo(0, originY);
          this.bezierCurveTo(originY, destX, destY, dy + 25 * signY, (height + target.height) / 2);
        }
      }
    }
  }

  bezierCurveTo(originY, destX, destY, dy, h) {
    const ddy = (destY - originY) / 2;
    const offset = Math.max(0, (h * Math.min(Math.abs(dy * 0.025), 1)) - Math.abs(dy)) * Math.sign(dy + 0.0001) * 2;
    const mid0Y = originY + ddy + offset;
    const mid1Y = destY - ddy + offset;

    this.container.bezierCurveTo(
      0, mid0Y,
      destX, mid1Y,
      destX, destY
    );
  }

  hasActiveNode() {
    if (!this.tree || !this.tree.nodeEventHandler) return false;
    const activeId = this.tree.nodeEventHandler.activeNodeId;
    return !!this.node && !!this.nodeId && !!activeId && activeId === this.nodeId;
  }

  idArrayIsEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v.sourceNodeId === b[i].sourceNodeId && v.targetNodeId === b[i].targetNodeId);
  }

  invalidateNode(node) {
    if (!!node && this.targetNodeIdSet.has(node.id)) {
      this.targetNodeIdSet.delete(node.id);
      this.targetNodeIds = this.targetNodeIds.filter(t => t !== node.id);
      this.targetNodes = this.targetNodes.filter(t => t !== node);
      this.render();
    } else if (this.node === node) {
      this.clear();
      this.render();
    }
  }
}
