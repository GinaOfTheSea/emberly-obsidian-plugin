

export default class RemoteDragHandler {


  constructor(sas, eventHandler) {
    this.sas = sas;
    this.eventHandler = eventHandler;
    this.node = null;
    this.nodeId = null;
    this.detached = false;
    this.timer = null;
    this.endTimerCall = () => this.forceDragEnd();
    this.targetX = 0;
    this.targetY = 0;
    this.lastMove = 0;
  }

  onTick(delta) {
    if (this.node !== null) {
      const ticks = 250.0 / (delta * 1000.0);
      const { x, y } = this.node.container;

      const dX = this.targetX - x;
      const dY = this.targetY - y;

      this.node.setPosition(
        x + dX / ticks,
        y + dY / ticks
      );

      if (this.node.synapse) {
        this.node.synapse.update();
      }
    }
  }

  onDrag(sas, ev) {
    const { nodeId, targetId, x, y, detached } = ev;
    // TODO update along bezier curve, etc. also remember to update redux
    if (nodeId !== this.nodeId) {

      if (this.node !== null) {
        // end dragging
        this.node.dragging = false;
        this.updateNode();
      }

      this.nodeId = nodeId;
      this.node = this.eventHandler.tree.getNodeById(nodeId);
      this.eventHandler.notify();
      this.node.dragging = true;
      this.node.setPosition(x, y);
    }

    if (this.node !== null) {
      this.node.dragging = true;

      this.targetX = x;
      this.targetY = y;

      if (detached && !!this.node.synapse) {
        const target = this.eventHandler.tree.getNodeById(targetId);
        this.node.synapse.setDetached(true, target);
      }

      this.updateNode();
    }

    this.pingEndTimer();
  }

  onDragEnd(sas, ev) {
    try {
      clearTimeout(this.timer);
      if (this.node !== null) {
        const { targetId, index, side, detached, x, y, disconnected } = ev;

        if (disconnected) {
          this.node.synapse.setDetached(false);
        } else if (detached) {
          this.node.setPosition(x, y);

          // Move node to new parent
          this.node.move(targetId, index, side, true, false);

          if (this.node.synapse.detached) {
            this.node.synapse.setDetached(false);
          }
          this.lastMove = Date.now();
          //parentId = null, indexInParent = null, side = null, rearrange = false, sync = true
        } else {
          this.node.setPosition(x, y);

          // Sort the nodes
          const parent = this.node.parent;
          if (!!parent) {
            const side = Math.sign(this.node.container.x - parent.container.x);
            this.node.move(null, null, side, true, false);
            this.lastMove = Date.now();
          }
        }

        this.node.dragging = false;
        this.node = null;
        this.nodeId = null;
        this.updateNode();
        this.eventHandler.notify();
      }
    } catch { }
  }

  onDisconnected() {
    const diff = Date.now() - this.lastMove;
    this.lastMove = 0;
    this.forceDragEnd();
    return diff > 500;
  }

  forceDragEnd() {
    if (this.node !== null) {
      this.node.dragging = false;
      this.node = null;
      this.nodeId = null;
      this.updateNode();
      this.eventHandler.notify();
    }
  }

  pingEndTimer() {
    clearTimeout(this.timer);
    this.timer = setTimeout(this.endTimerCall, 60000);
  }

  updateNode() {
    if (this.node !== null) {
      this.node.setDirty();
      this.eventHandler.tree.setTickDirty();
    }
  }

  get active() {
    return this.node !== null;
  }

  destroy() {
    this.lastMove = 0;
    this.node = null;
    clearTimeout(this.timer); // Next Session!!: if this is called before 500ms after a change has occured, and is not due to a shutdown, we trigger resync.!!!!
  }
}
