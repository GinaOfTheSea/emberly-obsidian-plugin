import { Graphics } from "../pixi";
import RasterSynapse from "../synapses/RasterSynapse";
import AABB from "../common/AABB";
import { Entity } from "@emberly/dataplane";


export default class NodeBase {

  constructor(entity, renderer, layout) {
    this.id = entity.id;
    this.entity = entity;
    this.renderer = renderer;
    this.container = new Graphics();
    this.isVisible = true;
    this.hoverNode = null;

    this.parent = null;
    this.indexInParent = 0;
    this.isCollapsed = entity.isCollapsed;
    this.children = [];
    this.side = entity.side;
    this.color = entity.color;
    this.renderColor = entity.color;

    this.synapse = null;
    this.depth = entity.depth;
    this.dirty = false;

    // interaction
    this.dragging = false;

    // joint offsets
    this.width = 0;
    this.height = 0;

    // positions
    this.globalPositionX = 0;
    this.globalPositionY = 0;
    this.optimalPositionX = 0;
    this.optimalPositionY = 0;
    this.offsetPositionX = 0;
    this.offsetPositionY = 0;
    this.textOffsetX = 0;
    this.textOffsetY = 0;
    this.isRoot = false;

    // init
    this.layout = layout;

    if (this.layout) {
      this.layout.setNode(this);
    }

    this.container.interactive = true;
    this.container.buttonMode = true;

    this.container
      .on("click", ev => this.renderer.emit("nodeclick", this, ev))
      .on("pointerdown", ev => this.renderer.emit("nodepointerdown", this, ev));
  }

  delete() {
    this.parent.removeChild(this);
    let nodes = [];
    this.getNodes(nodes);
    this.renderer.deleteNodes(nodes.sort((a, b) => b.depth - a.depth));
  }

  getNodes(arr) {
    arr.push(this);
    this.children.forEach(c => c.getNodes(arr));
  }

  removeChild(node) {
    let idx = this.children.indexOf(node);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      this.children.forEach((c, i) => { c.indexInParent = i });
      this.renderer.removeChild(node);
      this.render();
      this.setLayoutDirty();
    }
  }

  addChild(node) {

    const nodeVisible = this.isVisible && !this.isCollapsed;
    const root = this.renderer.root;

    node.parent = this;
    node.side = node.side || this.side;
    node.updateDepth();
    node.setVisibility(nodeVisible);

    if (this.children.length === 0) {
      node.indexInParent = this.children.length;
      this.children.push(node);
    } else {
      node.indexInParent = this.children.length;
      this.children.push(node);

      const next = node.getNextSibling()?.entity.index;
      const prev = node.getPreviousSibling()?.entity.index;
      const key = node.entity.index;
      if (
        (next && next < key) ||
        (prev && prev > key)
      ) {
        this.sortChildrenByEntity();
      }
    }


    this.renderer.addChild(node);

    if (node.synapse !== null) {
      node.synapse.parent = this;
      node.synapse.setDetached(false);
    } else {

      node.synapse = new RasterSynapse(this, node);
      node.container.addChild(node.synapse.graphics);

      if (!this.renderer.isFullTree() && this.isRoot) {
        node.synapse.graphics.visible = false;
      }

      if (this.renderer.isLoaded) {
        node.setPosition(this.container.x, this.container.y);
      } else {
        if (nodeVisible) {
          node.setAlpha(0.01);
        }
        node.setPosition(root.globalPositionX + this.width * this.side * 0.5, root.globalPositionY);
      }
    }

    node.updateColor();
    this.setLayoutDirty();
  }

  updateDepth() {
    this.depth = this.parent.depth + 1;
    this.side = this.parent.side || this.side;
    this.children.forEach(c => c.updateDepth());
  }

  onTick(delta) {
    if (this.dirty && this.isVisible) {
      const x = this.getPositionX();
      const y = this.getPositionY();
      const g = this.container;

      // TODO normalize velocity, vX etc, dont let it jump too far because of delta.
      const vX = x + this.offsetPositionX - g.x;
      const vY = y + this.offsetPositionY - g.y;
      const vel = vX * vX + vY * vY;
      const hasDelta = vel > 0.05;

      if (!this.dragging) {
        this.setPosition(
          g.x + vX * Math.min(0.25, delta * 12),
          g.y + vY * Math.min(0.25, delta * 12)
        );
      }

      if (hasDelta) {
        if (this.synapse) {
          this.synapse.update();
        }
      }

      const parent = this.depth === 1 ? this.renderer.root : this.parent;

      if (!hasDelta && !this.dragging && this.hoverNode === null && (this.parent === null || !parent.dirty)) {
        this.dirty = false;
        this.setPosition(
          x + this.offsetPositionX,
          y + this.offsetPositionY
        );

        if (this.synapse) {
          this.synapse.update();
        }
      }
    }
  }

  skipAnimations() {
    this.dirty = false;
    this.setAlpha(1);
    const x = this.getPositionX();
    const y = this.getPositionY();
    this.setPosition(x, y);

    if (this.synapse) {
      this.synapse.update();
    }
  }

  updateColor() {
    if (this.parent !== null) {
      if (this.entity.rgbColor === null) {
        this.onUpdateColor();
      } else {
        this.desaturateColor();
      }
    }

    this.render();

    if (!!this.synapse) {
      this.synapse.update();
    }

    this.children.forEach(c => c.updateColor());
  }

  setColor(color, force = false) {
    if (this.color !== color || force) {
      this.color = color;
      this.updateColor();
    }
  }

  hasParent(node) {
    return this.parent !== null && (this.parent === node || this.parent.hasParent(node));
  }

  onClick(ev) { } // Override

  onDoubleClick(ev) { } // Override

  onUpdateColor() { } // Override

  render() { } // Override

  onNodeHoverEnter(node) {
    this.hoverNode = node;
    this.setDirty();
  }

  onNodeHoverMove(node) {
    const dc = node.container;
    const dcX = dc.x;
    const dcY = dc.y;

    let deltaDragX = (dcX - this.container.x) / 10;
    let deltaDragY = (dcY - this.container.y);

    let dragDelta = Math.max(Math.sqrt(deltaDragX * deltaDragX + deltaDragY * deltaDragY), 1);
    this.offsetPositionX = -(deltaDragX / dragDelta) * 15;
    this.offsetPositionY = -(deltaDragY / dragDelta) * 25;

    this.setDirty();
  }

  onNodeHoverExit() {
    this.hoverNode = null;
    this.offsetPositionX = 0;
    this.offsetPositionY = 0;
    this.setDirty();
  }

  setPosition(x, y) {
    const container = this.container;
    container.x = x;
    container.y = y;
  }

  // TODO override this one so we dont need branch here
  getPositionX() {
    if (this.parent === null) {
      return this.optimalPositionX;
    }

    const side = this.parent.layout.getSide();
    return this.parent.container.x + (this.optimalPositionX + (this.parent.width + this.width) / 2) * side;
  }

  // TODO override this one so we dont need branch here.
  getPositionY() {
    return this.parent === null ? this.optimalPositionY : this.parent.container.y + this.optimalPositionY;
  }

  setLayoutDirty() {
    if (!!this.layout) {
      this.renderer.setDirty(this.layout.getSide());
    }
  }

  setDirty() {
    this.subSetDirty();
    this.renderer.setTickDirty();
  }

  subSetDirty() {
    this.dirty = true;

    if (this.children && this.children.length !== 0) {
      this.children.forEach(c => c.subSetDirty());
    }
  }

  setVisibility(visibility) {
    if (this.dragging && !visibility && this.renderer.nodeEventHandler?.draggingNode === this) return;
     
    this.isVisible = visibility;
    this.container.visible = visibility;

    if (!this.isCollapsed) {
      this.children.forEach(c => c.setVisibility(visibility));
    }

    this.render();
  }

  onUpdated() {
    this.subSetDirty();
    if (this.isCollapsed !== this.entity.isCollapsed) {
      this.setIsCollapsed(this.entity.isCollapsed, true);
    } else if (!this.entity.isCollapsed) {
      this.renderer.nodeEventHandler.handleRemoteUncollapse(this);
    }

    if (this.color !== this.entity.color) {
      this.setColor(this.entity.color);
    }

    const next = this.getNextSibling();
    const prev = this.getPreviousSibling();

    const shouldMoveIndex = (!!next && next.entity.index < this.entity.index) || (!!prev && prev.entity.index > this.entity.index);
    const hasMove = this.parent !== null && (
      this.parent.id !== this.entity.parentId ||
      (this.side !== this.entity.side && this.depth === 1) ||
      shouldMoveIndex
    );

    if (hasMove) {
      const index = this.findFittingIndex(this.entity.index);
      this.move(this.entity.parentId, index, this.entity.side, false, false, true);
    } else {
      this.setLayoutDirty();
    }
    
    this.render();
    this.renderer.nodeEventHandler.onUpdatedNode(this);
  }

  // TODO refactor this to sync with entity unless reArrange is set?
  move(parentId = null, indexInParent = null, side = null, rearrange = false, sync = true, skipEvents = false) {
    const parent = typeof parentId === "string" && parentId !== "inbox" ? this.renderer.getNodeById(parentId) : this.parent;

    if (parent === null) return false;

    const nIndex = typeof indexInParent === "number" ? indexInParent : parent.children.length;
    const nSide = typeof side === "number" ? side : this.side;
    const movedParent = parent.id !== this.parent.id;
    const movedSide = (nSide !== this.side || nSide !== this.entity.side) && parent.isRoot;
    const movedIndex = movedParent || movedSide || nIndex !== this.indexInParent || rearrange;
    const oldParent = this.parent;

    const oldParentId = this.parent.id;
    const oldSide = this.side;
    const oldIndex = this.indexInParent;


    // move parent
    if (movedParent) {
      const oldColor = this.getFirstSetColor();
      const oldParent = this.parent;
      this.parent.removeChild(this);
      parent.addChild(this, nSide);

      if (!!this.synapse) {
        this.synapse.attachTarget = this.parent;
      }
      
      if (parent.isRoot) {
        if (this.entity.rgbColor === null) {


          this.entity.setColor(oldColor, { sync: false });
        }
        
        this.setColor(this.entity.color, true);
      } else if (oldParent.isRoot && sync) {
        this.entity.unsetColor({ sync: false });
      }

      if (!skipEvents) {
        parent.setIsCollapsed(false);
        if (!this.parent.isRoot && sync) {
          this.parent.entity.setIsCollapsed(false, { instanceId: this.renderer.instanceId });

          if (oldParent.children.length === 0 && !!oldParent.entity?.isCollapsed) {
            oldParent.setIsCollapsed(false);
            oldParent.entity.setIsCollapsed(false, { instanceId: this.renderer.instanceId });
            oldParent.render();
          }
        }
      }

      if (rearrange) {
        this.entity.setParentId(this.parent.id, { sync: false, refresh: true, instanceId: this.renderer.instanceId });
      }
    }

    // move side
    if (movedSide) {
      let oldSide = this.side;
      this.side = nSide;

      if (this.depth === 1 && oldSide !== this.side) {
        parent.removeChild(this);
        this.renderer.root.addChild(this, this.side);
      }

      if (rearrange) {
        this.entity.setSide(this.side, { sync: false });
      }
    }

    // move index
    if (movedIndex) {
      const siblings = this.parent.children;
      if (rearrange) {
        siblings.sort((a, b) => a.container.y - b.container.y);
        siblings.forEach((n, i) => { n.indexInParent = i;  n.setZIndex(); });
        const prev = this.getPreviousSibling();
        const next = this.getNextSibling();
        this.entity.placeBetween(prev?.entity, next?.entity, { sync: false, instanceId: this.renderer.instanceId });
        this.setLayoutDirty();
      } else {
        this.parent.sortChildrenByEntity();
      }
      // TODO update render on root change
      parent.updateColor();
      this.renderer.updateLayerOrder();
    } 

    if (movedParent || movedSide) {
      oldParent.sortChildrenByEntity();
    }

    this.updateDepth();

    const hasUpdate = oldParentId !== this.parent.id || oldSide !== this.side || oldIndex !== this.indexInParent;

    // Sync
    if (sync && hasUpdate) {
      this.entity.depth = this.depth;
      this.entity.update("updated", { instanceId: this.renderer.instanceId });
    }

    this.renderer.removeFromParentBuffer(this.id);

    return movedIndex;
  }

  findFittingIndex(indexKey) {
    const siblings = this.getSiblings();
    for (let i = 0; i < siblings.length; i++) {
      const key = siblings[i].entity.index;
      if (key > indexKey) return Math.max(0, i - 1);
    }
    return siblings.length;
  }

  sortChildrenByEntity() {
    this.children.sort((a, b) => Entity.Compare(a.entity, b.entity));
    this.children.forEach((t, i) => { t.indexInParent = i; t.setZIndex(); });
    this.setLayoutDirty();
  }

  setIsCollapsed(isCollapsed, force = false) {
    if ((this.isCollapsed !== isCollapsed && this.children.length !== 0) || force) {
      this.isCollapsed = isCollapsed;

      if (!this.isCollapsed) {
        const side = Math.sign(this.container.x - this.renderer.root.container.x);
        this.callRecursive(c => c !== this && !c.isVisible && c.setPosition(this.container.x + this.getWidth() * side, this.container.y));
      }

      this.children.forEach(c => c.setVisibility(!this.isCollapsed));
      this.render();
      this.setLayoutDirty();
      this.renderer.linkRenderer.render();
    }
  }

  getWidth() {
    return 0;
  }

  getHeight() {
    return 0;
  }

  getDepth() {
    let maxDepth = this.depth;

    for (let i = 0; i < this.children.length; i++) {
      maxDepth = Math.max(maxDepth, this.children[i].getDepth());
    }

    return maxDepth;
  }

  isLeaf() {
    return this.children.length === 0 || this.isCollapsed;
  }

  isLeftMost() {
    return this.indexInParent === 0;
  }

  isRightMost() {
    return this.indexInParent === this.parent.children.length - 1;
  }

  getSiblings() {
    return this.parent === null ? [this] : this.parent.children;
  }

  getGlobalSiblings() {
    let result = [];

    if (this.side === -1) {
      this.renderer.root.leftTree.fillGlobalSiblings(result, this.depth);
    } else {
      this.renderer.root.rightTree.fillGlobalSiblings(result, this.depth);
    }

    return result;
  }

  fillGlobalSiblings(result, depth) {
    if (this.depth === depth) {
      result.push(this);
    } else {
      for (let i = 0; i < this.children.length; i++) {
        this.children[i].fillGlobalSiblings(result, depth);
      }
    }
  }

  getPreviousSibling() {
    if (this.isLeftMost()) {
      return null;
    } else {
      return this.parent.children[this.indexInParent - 1];
    }
  }

  getNextSibling() {
    if (this.isRightMost()) {
      return null;
    } else {
      return this.parent.children[this.indexInParent + 1];
    }
  }

  getLeftMostSibling() {
    if (this.isLeftMost()) {
      return this;
    } else {
      return this.parent.children[0];
    }
  }

  getLeftMostChild() {
    return this.children.length === 0 || this.isCollapsed ? null : this.children[0];
  }

  getRightMostChild() {
    return this.children.length === 0 || this.isCollapsed ? null : this.children[this.children.length - 1];
  }

  callRecursive(fn) {
    fn(this);
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].callRecursive(fn);
    }
  }

  getBranch() {
    const arr = [];
    this.callRecursive(c => arr.push(c));
    return arr;
  }

  getBranchExclusive() {
    const arr = [];
    const callback = c => arr.push(c);
    this.children.forEach(n => n.callRecursive(callback));
    return arr;
  }

  getPath() {
    let result = [];
    let n = this;

    while (n !== null && !n.isRoot) {
      result.push(n.name);
      n = n.parent;
    }

    result.reverse();

    return result;
  }

  callParents(fn) {
    if (this.parent !== null && !this.parent.isRoot) {
      fn(this.parent);
      this.parent.callParents(fn);
    }
  }

  getAABB(maxDepth = 100) {
    const w05 = this.width / 2;
    const h05 = this.height / 2;
    const aabb = new AABB(this.globalPositionX - w05, this.globalPositionY - h05, this.globalPositionX + w05, this.globalPositionY + h05);
    this.fillAABB(aabb, maxDepth);
    return aabb;
  }

  fillAABB(aabb, maxDepth) {
    if (this.isVisible) {
      aabb.update(this);
      if (--maxDepth > 0) {
        this.children.forEach(c => c.fillAABB(aabb, maxDepth));
      }
    }
  }

  getNodeData() {
    return {
      id: this.id,
      parentId: this.parent ? this.parent.id : null,
      indexInParent: this.indexInParent,
      depth: this.depth,
      side: this.depth === 1 ? this.parent.layout.side : undefined
    };
  }

  getBranchRoot() {
    if (this.depth === 0) {
      return null;
    } else if (this.depth === 1 || this.parent?.isRoot) {
      return this;
    }
    return this.parent.getBranchRoot();
  }

  // recur towards root and look for first parent with a color thats actually set.
  getFirstSetColor() {
    if (!this.parent) {
      return 0x0;
    } else if (this.entity.rgbColor !== null) {
      return this.entity.rgbColor;
    }
    return this.parent.getFirstSetColor();
  }

  isSelected() {
    return !this.renderer.closed && (this.id === this.renderer.nodeEventHandler.activeNodeId || this === this.renderer.nodeEventHandler.dragOverNode);
  }

  hasActiveLink() {
    return this.renderer.linkRenderer.hasActiveNode() && this.renderer.linkRenderer.targetNodeIdSet.has(this.id);
  }

  getFirstInvisibleParent() {
    if (this.parent === null || this.parent.isVisible) {
      return this;
    } else {
      return this.parent.getFirstInvisibleParent();
    }
  }

  isBranchDragging() {
    let buf = this.parent;

    while (buf != null) {
      
      if (buf.synapse?.detached) {
        return true;
      }

      buf = buf.parent;
    }

    return false;
  }

  isCategoryNode() {
    return this.depth === 1 && (this.parent.id === "left_attachment" || this.parent.id === "right_attachment");
  }

  setZIndex() { }

  destroy() {
    if (!!this.synapse) {
      this.synapse.graphics.destroy();
    }

    this.container.destroy();
  }

  isInPath(node) {
    let parent = this;
    while (!!parent) {
      if (node === parent) {
        return true;
      }
      parent = parent.parent;
    }

    return false;
  }


  invalidateNode(node) {
    if (!!this.synapse && node !== this) {
      // invalidate synapse
      this.synapse.invalidateNode(node);
    } else if (node === this) {
      // stop all motions and events, this node is now invalid
      const handler = this.renderer.nodeEventHandler;

      if (handler?.draggingNode?.id === this.id) {
        handler.cancelDrag();
      }

      if (this.isSelected()) {
        //this.renderer.root
        this.renderer.emit("onNodeFocused", this.renderer.root);
      }

    }
  }

  setAlpha(alpha) {
    this.container.alpha = alpha;
  }

}