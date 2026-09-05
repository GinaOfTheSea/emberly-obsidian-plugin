import { Point } from "../pixi";
import { Debounce } from "@emberly/dataplane";
import RemoteDragHandler from "./RemoteDragHandler";

export default class NodeEventHandler {

  constructor(tree, viewport, context) {
    this.viewport = viewport;
    this.context = context;
    this.hidden = false;
    this.tree = tree;
    this.draggingNode = null;
    this.closestNode = null;
    this.closestNodes = new Set();
    this.eventData = null;
    this.dragging = false;
    this.dragMoved = false;
    this.eventOffset = new Point(0, 0);
    this.eventPosition = new Point(0, 0);
    this.deltaClick = Date.now();
    this.clickedNode = null;
    this.dragEnabled = false;
    this.dragOverActive = false;
    this.dragOverX = 0;
    this.dragOverY = 0;
    this.renderDragOverX = 0;
    this.renderDragOverY = 0;
    this.dragOverNode = null;
    this.activeNodeId = null;
    this.lastMovedNode = null;
    this.collapsedParent = null;
    this.searchDebouncer = new Debounce(8);
    this.detachDebouncer = new Debounce(8);
    this.tempUncollapsedNodes = [];
    this.activeDrags = new Map();
    this.dirty = false;

    this.transmitTimer = null;
    this.lastTransmitEvent = null;
    this.lastTransmitTime = 0;
    this.onTransmitDragEvent = () => this.transmitDragEvent(this.lastTransmitEvent);

    this.onPointerUp = event => this.onNodePointerUp(null, event);
    this.onPointerMove = event => this.onNodePointerMove(null, event);
    this.onPointerOut = ev => this.tree.emit("treepointerout", this.tree, ev);
    this.onPointerOver = event => this.tree.resetRenderTimer();

    this.viewport
      .on("pointerover", this.onPointerOver)
      .on("pointermove", this.onPointerMove)
      .on("pointerup", this.onPointerUp)
      .on("pointerout", this.onPointerOut);

    this.tree
      .on("nodeclick", (node, event) => this.onNodeClick(node, event))
      .on("nodepointerdown", (node, event) => this.onNodePointerDown(node, event))
      .on("treepointerout", (tree, event) => this.onTreePointerOut(tree, event));


    this.onHandleRemoteDrag = (sas, ev) => this.onRemoteDrag(sas, ev);
    this.onHandleRemoteDragEnd = (sas, ev) => this.onRemoteDragEnd(sas, ev);

    this.context
      .on("OnDrag", this.onHandleRemoteDrag)
      .on("OnDragEnd", this.onHandleRemoteDragEnd);


    this.onRemoteActiveInput = (sas, resourceId, inputId) => {
      // When disconnect, end the drag if its active.
      if (resourceId === null && inputId === null) {
        this.onRemoteDragEnd(sas, { disconnected: true });
      }
    };

    this.onRemoteBlur = (contextId, inputId) => {
      if (this.tree.contextId === contextId && !!this.draggingNode && this.draggingNode.id === inputId) {
        this.cancelDrag();
      }
    };

    this.onHandleRemoteDragDisconnected = (sas) => this.onRemoteDragDisconnected(sas);

    this.context.getConnections()
      .on("onActiveInput", this.onRemoteActiveInput)
      .on("onBlur", this.onRemoteBlur)
      .on("onUserDisconnected", this.onHandleRemoteDragDisconnected);

    this.visibilityCallback = () => this.run();
    this.setDocument(tree.renderer.view.ownerDocument);
  }

  onRemoteDrag(sas, ev) {
    if (!this.activeDrags.has(sas.pcid)) {
      this.activeDrags.set(sas.pcid, new RemoteDragHandler(sas, this));
    }

    this.activeDrags.get(sas.pcid).onDrag(sas, ev);
  }

  onRemoteDragEnd(sas, ev) {
    if (!this.activeDrags.has(sas.pcid)) {
      this.activeDrags.set(sas.pcid, new RemoteDragHandler(sas, this));
    }

    this.activeDrags.get(sas.pcid).onDragEnd(sas, ev);
  }

  onRemoteDragDisconnected(sas) {
    if (this.activeDrags.has(sas.pcid)) {
      if (!this.activeDrags.get(sas.pcid).onDisconnected()) {
        this.tree.manager.syncToRemote();
      }
    }
  }

  isAnyDragActive() {
    if (this.dragging) {
      return true;
    } else if (this.activeDrags.size !== 0) {
      for (let drag of this.activeDrags.values()) {
        if (drag.node !== null) {
          return true;
        }
      }
    }

    return false;
  }

  setDocument(doc) {
    this.document?.removeEventListener("visibilitychange", this.visibilityCallback, false);
    this.document = doc;
    doc.addEventListener("visibilitychange", this.visibilityCallback, false);
    this.run();
  }

  run() {
    this.hidden = this.document.visibilityState === "hidden";
    if (!this.hidden) this.tree.setTickDirty();
  }

  onNodeClick(node, event) {
    const time = Date.now();
    const delta = time - this.deltaClick;

    if (delta > 25 && (this.draggingNode === null || this.draggingNode === node) && !this.dragMoved) {
      this.deltaClick = time;

      if (delta > 300 || node !== this.clickedNode) {
        node.onClick(event);
      } else if (node === this.clickedNode) {
        node.onDoubleClick(event);
      }

      this.clickedNode = node;
      this.deltaClick = Date.now();
    }
  }

  onNodePointerDown(node, event) {

    const touches = event?.data?.originalEvent?.touches?.length || 1;

    if (this.draggingNode === null && !node.dragging && touches <= 1) { // TODO enable clicking even when there is a dragging node.
      this.eventsTransmitted = 0;

      if (this.dragEnabled) {
        this.tree.pause();
      }

      this.draggingNode = node;
      this.draggingNode.dragging = true;
      this.eventData = event.data;

      if (!!this.draggingNode.renderText) {
        this.draggingNode.renderText.alpha = 0.5;
      }

      this.dragging = true;
      this.dragMoved = false;
      const container = node.container;

      const vt = this.tree.viewport.transform;

      this.eventOffset.set(
        -container.x + (event.data.global.x - vt.position.x) / vt.scale.x,
        -container.y + (event.data.global.y - vt.position.y) / vt.scale.y
      );

      this.eventPosition.set(
        event.data.global.x,
        event.data.global.y
      )

      this.draggingNode.setDirty();
    }
  }

  onNodePointerUp(node, event) {
    this.searchDebouncer.clear();
    this.detachDebouncer.clear();

    if (!this.dragging) {
      return;
    }

    // Clear transmit to context
    clearTimeout(this.transmitTimer);
    this.lastTransmitEvent = null;


    const n = this.draggingNode;
    const x = n.container.x;
    const synapse = n.synapse;

    const transmit = this.context.getConnections().hasConnections();

    if (this.dragMoved && n.depth !== 0 && this.dragEnabled === true && !!synapse && this.context.canEdit()) {
      // TODO calculate index based on position.
      const detached = synapse.detached;
      const parent = synapse.attachTarget.isRoot ? this.tree.root : synapse.attachTarget;
      const side = Math.sign(x - parent.container.x);

      n.move(
        parent.id,
        null,
        side,
        true,
        true
      );

      // if we didnt successfully move, set the synapse to no longer be detached.
      if (synapse.detached) {
        synapse.setDetached(false);
      }

      if (transmit) {
        this.context.send("OnDragEnd", { x, y: n.container.y, nodeId: n.id, targetId: synapse ? synapse.attachTarget.id : null, index: n.indexInParent, side, detached });
      }
    } else if (transmit && this.eventsTransmitted > 0) {
      this.context.send("OnDragEnd", { x, y: n.container.y, nodeId: n.id, targetId: synapse ? synapse.attachTarget.id : null, index: n.indexInParent, side: 0, detached: false });
    }

    this.context.getConnections().blurActiveInput(this.tree.contextId);
    this.closestNodes.forEach(c => c.onNodeHoverExit(n));
    this.closestNodes.clear();

    if (!!n.renderText) {
      n.renderText.alpha = 1;
    }

    n.dragging = false;

    if (n.parent?.isCollapsed && n.isVisible) {
      n.setVisibility(false);
      if (this.activeNodeId === n.id) {
        this.setActiveNodeId(n.id, true);
      }
    }


    if (this.dragEnabled) {
      this.tree.resume();
    }

    this.onNodeClick(n, event);

    this.eventData = null;
    this.dragMoved = false;
    this.dragging = false;
    this.draggingNode = null;
  }

  cancelDrag() {
    clearTimeout(this.transmitTimer);
    this.dragMoved = false;
    this.searchDebouncer.clear();
    this.detachDebouncer.clear();
    this.lastTransmitEvent = null;

    if (!!this.draggingNode) {
      this.closestNodes.forEach(c => c.onNodeHoverExit(this.draggingNode));
      this.closestNodes.clear();
      if (!!this.draggingNode.renderText) {
        this.draggingNode.renderText.alpha = 1;
      }
      this.draggingNode.dragging = false;
    }

    if (this.dragEnabled) {
      this.tree.resume();
    }

    this.eventData = null;
    this.dragMoved = false;
    this.dragging = false;
    this.draggingNode = null;
  }

  onNodePointerMove(node, event) {
    if (this.dragging) {

      if (event?.data?.originalEvent?.touches?.length > 1) {
        this.onNodePointerUp(node, event);
        return;
      }

      const n = this.draggingNode;
      const container = n.container;
      const synapse = n.synapse;
      const newPosition = this.eventData.getLocalPosition(container.parent);
      const pX = newPosition.x - this.eventOffset.x;
      const pY = newPosition.y - this.eventOffset.y;

      if (!this.dragMoved) {
        let deltaX = (event.data.global.x - this.eventPosition.x);
        let deltaY = (event.data.global.y - this.eventPosition.y);
        let dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        this.dragMoved = this.dragEnabled ? dist > 4 : dist > 10;

        if (n.isBranchDragging() || (this.dragMoved && !this.context.getConnections().setActiveInput(this.tree.contextId, n.id))) {
          this.cancelDrag();
        }
      }

      if (this.dragEnabled === false) {
        return;
      }

      n.setPosition(pX, pY);

      if (n === this.tree.root) {
        this.transmitDragEvent({ x: pX, y: pY, nodeId: n.id, targetId: null, detached: false })
        return;
      }

      // TODO
      const w05 = n.width / 2;
      const h05 = n.height / 2;

      const closest = this.searchDebouncer.debounce(
        () => new Set(
          this.tree.findInAABB(
            container.x - w05,
            container.y - h05,
            container.x + w05,
            container.y + h05,
            n
          )
        )
      );

      this.closestNodes.forEach(c => {
        if (!closest.has(c)) {
          c.onNodeHoverExit(n);
        }
      });

      closest.forEach(c => {
        if (!this.closestNodes.has(c)) {
          c.onNodeHoverEnter(n);
        }
        c.onNodeHoverMove(n);
      });

      this.closestNodes = closest;

      // handle detach
      if (!!synapse && this.context.canEdit()) {
        let deltaWidth = (n.parent.width + n.width) * 0.5;
        let defaultDistance = (n.getPositionX() - n.parent.getPositionX()) * n.side - deltaWidth;
        let offsetParentX = (container.x - n.parent.container.x) * n.side - deltaWidth;

        let leftChild = n.parent.getLeftMostChild();
        let rightChild = n.parent.getRightMostChild();

        let minY = !!leftChild ? leftChild.getPositionY() - n.height * 3 : 0;
        let maxY = !!rightChild ? rightChild.getPositionY() + n.height * 3 : 9999999;
        let y = container.y;

        if (
          ((y < minY || y > maxY || offsetParentX < 0) && n.depth > 1) ||
          offsetParentX > defaultDistance * 1.5 ||
          (n.depth === 1 && Math.abs(offsetParentX) > defaultDistance * 2.5)
        ) {
          synapse.setDetached(true);
        }

        // find closest and set to renderTarget
        if (synapse.detached) {
          let attachTarget = this.detachDebouncer.debounce(() => this.tree.findClosestByOpposingJoints(n, 1500));

          if (attachTarget && !attachTarget.isBranchDragging() && !attachTarget.synapse?.detached) {
            attachTarget.setDirty();
            synapse.setDetached(true, attachTarget);
          }
        }
      }

      n.setDirty();
      
      const p = n.getPreviousSibling();
      
      if (!!p) {
        p.dirty = true;
      }

      this.tree.setTickDirty();
      this.transmitDragEvent({ x: pX, y: pY, nodeId: n.id, targetId: synapse ? synapse.attachTarget.id : null, detached: synapse ? synapse.detached : false })
    }

  }

  onResourceDrop(ev) {

    if (!this.context.canEdit()) {
      return;
    }

    const viewport = this.tree.viewport;
    const data = ev.dataTransfer.getData("text");
    const coords = viewport.toWorld(ev.clientX, ev.clientY);
    let closestNode = this.tree.findNode(coords.x, coords.y);

    if (closestNode !== null && closestNode !== this.tree.root) {

      if (data.startsWith("http")) {
        // add url as new resource
        this.tree.emit("onResourceCreateRequested", closestNode.id, data);
      } else {
        // TODO handle file uploads
        this.tree.emit("onFileUploadRequested", closestNode.id, ev.dataTransfer);
      }
    }
  }

  transmitDragEvent(ev) {
    const time = Date.now();
    const timeSinceTransmit = time - this.lastTransmitTime;
    this.lastTransmitEvent = ev;
    this.eventsTransmitted++;
    clearTimeout(this.transmitTimer);

    if (timeSinceTransmit > 250 && this.lastTransmitEvent !== null) {
      this.lastTransmitTime = time;
      if (this.context.getConnections().hasConnections()) {
        this.context.send("OnDrag", this.lastTransmitEvent);
      }
    } else {
      this.transmitTimer = setTimeout(this.onTransmitDragEvent, 250);
    }
  }

  onTreePointerOut(tree, event) {
    if (this.dragging) {
      this.onNodePointerUp(null, event);
    }
  }

  setDragEnabled(enabled) {
    this.dragEnabled = enabled;
  }

  setActiveNodeId(id, force = false) {
    if (id !== this.activeNodeId || force) {

      this.tree.linkRenderer.clear();
      const newNode = this.tree.getNodeById(id);
      const oldNode = this.tree.getNodeById(this.activeNodeId);
      this.activeNodeId = id;
      let prevCollapsedParent = null;

      if (!!oldNode) {
        oldNode.render();

        if (this.collapsedParent !== null && this.collapsedParent.parent !== null && this.tempUncollapsedNodes.length !== 0) {

          this.tempUncollapsedNodes.forEach(parent => {
            parent.setIsCollapsed((parent.entity?.isCollapsed || false) && parent.children.length !== 0, true);
          });

          this.tempUncollapsedNodes = [];
          this.collapsedParent.setLayoutDirty();
        }

        prevCollapsedParent = this.collapsedParent;
        this.collapsedParent = null;
      }

      if (!!newNode) {
        if (!newNode.isVisible || (!!prevCollapsedParent && newNode.isInPath(prevCollapsedParent))) {
          const hNode = newNode.getFirstInvisibleParent();

          newNode.callParents((parent) => {
            if (parent.isCollapsed || parent.entity.isCollapsed) {
              parent.isCollapsed = false;
              this.tempUncollapsedNodes.push(parent);
            }
          });

          this.collapsedParent = hNode;
          hNode.setVisibility(true);
          this.tree.setDirty(0);
        }

        newNode.render();
      }
      // Reconcile note references after legacy selection/visibility clears.
      this.tree.emit("onActiveNodeChanged", id);
    }

    this.tree.setTickDirty();
  }

  handleRemoteUncollapse(node) {
    if (this.isTempVisible(node)) {
      this.setActiveNodeId(this.activeNodeId, true);
    }
  }

  isTempVisible(node) {
    return this.collapsedParent !== null && !!this.tempUncollapsedNodes.find(t => t.id === node.id);
  }

  onUpdatedNode() {
    if (!!this.activeNodeId) {
      const node = this.tree.getNodeById(this.activeNodeId);
      if (!!node && !node.isVisible) {
        this.setActiveNodeId(this.activeNodeId, true);
      }
    }
  }

  setDragOverActive(active) {
    if (this.dragOverActive !== active) {

      this.dragOverActive = active;
      this.dragOverX = 0;
      this.dragOverY = 0;
      let node = this.dragOverNode;
      this.dragOverNode = null;

      if (node !== null) {
        node.render();
      }
    }
  }

  onDragOver(x, y) {
    this.dragOverX = x;
    this.dragOverY = y;
    this.tree.setTickDirty();
  }

  render() {
    if (this.dragOverActive && (this.renderDragOverX !== this.dragOverX || this.renderDragOverY !== this.dragOverY)) {
      this.renderDragOverX = this.dragOverX;
      this.renderDragOverY = this.dragOverY;

      const viewport = this.tree.viewport;
      const coords = viewport.toWorld(this.dragOverX, this.dragOverY);
      let closestNode = this.tree.findNode(coords.x, coords.y);

      if (closestNode !== null && closestNode !== this.tree.root && this.dragOverNode !== closestNode) {
        const node = this.dragOverNode;
        this.dragOverNode = closestNode;

        if (node !== null) {
          node.render();
        }

        this.dragOverNode.render();
      } else if (closestNode === null && this.dragOverNode !== null) {
        const node = this.dragOverNode;
        this.dragOverNode = null;
        if (node !== null) {
          node.render();
        }
      }
    }
  }

  onTick(delta) {
    if (this.dirty) {
      this.activeDrags.forEach(t => t.onTick(delta));
    }
  }

  setContextLost() {
    // Pixi restores its resources on webglcontextrestored; keep recovery local.
    this.tree.setTickDirty();
  }

  notify() {
    this.dirty = false;
    this.activeDrags.forEach(t => {
      this.dirty = this.dirty || t.active
    });
  }

  destroy() {
    this.document.removeEventListener("visibilitychange", this.visibilityCallback, false);

    clearTimeout(this.transmitTimer);

    if (this.dragging) {
      try {
        this.cancelDrag();
        this.context.getConnections().blurActiveInput(this.tree.contextId);
      } catch { }
    }

    this.activeDrags.forEach(t => t.destroy());
    this.activeDrags.clear();

    this.context
      .off("OnDrag", this.onHandleRemoteDrag)
      .off("OnDragEnd", this.onHandleRemoteDragEnd);

    this.context.getConnections()
      .off("onUserDisconnected", this.onHandleRemoteDragDisconnected)
      .off("onActiveInput", this.onRemoteActiveInput)
      .off("onBlur", this.onRemoteBlur);

    this.viewport
      .off("pointerover", this.onPointerOver)
      .off("pointermove", this.onPointerMove)
      .off("pointerup", this.onPointerUp)
      .off("pointerout", this.onPointerOut);
  }
}
