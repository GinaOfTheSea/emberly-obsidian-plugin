import RootNode from "./nodes/RootNode";
import DynamicAtlas from "./text/DynamicAtlas";
import { loadEmberlyFonts } from "../renderer-assets";
import InteractiveNode from "./nodes/InteractiveNode";
import RasterStyles from "./common/RasterStyles";
import RootLayout from "./layouts/RootLayout";
import ClusterLayout from "./layouts/ClusterLayout";
import EventEmitter from "events";
import NodeEventHandler from "./common/NodeEventHandler";
import LinkRenderer from "./common/LinkRenderer";
import ImageUtility from "../common/ImageUtility";
import { TreeHelper } from "@emberly/dataplane";
import { renderToCanvas } from "./common/Screenshot";

let initialLoad = false;
const MAX_ANIMATED = 200;

export default class TreeRenderer extends EventEmitter {

  constructor(contextId, isEmbed, renderer, viewport, collection, themeMode = "light") {
    super();
    this.contextId = contextId;
    this.isEmbed = isEmbed;
    this.styles = new RasterStyles();
    this.viewport = viewport;
    this.renderer = renderer;
    this.ownerWindow = renderer.view.ownerDocument.defaultView;
    this.textAtlas = new DynamicAtlas(1, renderer.view.ownerDocument);
    this.eventsEnabled = false;
    this.isLoaded = false;
    this.instanceId = Date.now() + "";
    this.worldHeight = 10000;
    this.worldWidth = 10000;

    this.themeMode = themeMode;

    // render state
    this.opened = false;
    this.closed = false;
    this.mounted = false;
    this.tickDirty = true;
    this.dirty = true;
    this.dirtySide = 0;
    this.renderTimer = 0;
    this.zoomWidthTarget = 1000;
    this.alpha = 0.01;

    // nodes
    this.root = null;
    this.nodes = [];
    this.nodeDictionary = new Map();
    this.parentBuffer = new Map();
    this.parentBufferLinks = new Map();
    this.lastRenderTick = this.ownerWindow.performance.now();
    this.running = true;

    this.requestRenderTickReference = (time) => this.requestRenderTick(time);

    // handlers
    this.manager = collection;
    this.nodeEventHandler = new NodeEventHandler(this, viewport, this.manager.context);

    // Add LinkRenderer
    this.linkRenderer = new LinkRenderer(this);
    this.viewport.addChild(this.linkRenderer.container);

    // TODO handlers
    this.onNodeUpdated = (entity, instanceId) => {
      if (this.instanceId !== instanceId && this.nodeDictionary.has(entity.id)) {
        this.nodeDictionary.get(entity.id).onUpdated();
      }
    };

    this.onNodeDeleted = (entity, instanceId) => {
      if (this.instanceId !== instanceId && this.nodeDictionary.has(entity.id)) {
        const node = this.getNodeById(entity.id);
        if (!!node) {
          this.nodes.forEach(t => t.invalidateNode(node));
          this.linkRenderer.invalidateNode(node);
          node.parent.removeChild(node);
          this.deleteNodes([node], false);
        }
      }
    };

    this.onNodeCreated = (entity, instanceId) => {
      if (this.instanceId !== instanceId) {
        this.createNode(entity);
        this.linkRenderer.onNodeCreated(entity.id);
      }
    };

    // TODO!!!!

    // initial setup
    this.renderer.render(this.viewport.parent);
    loadEmberlyFonts(renderer.view.ownerDocument).then(() => this.setup());
    this.onContextRestored = () => { if (this.running) this.setTickDirty(); };
    renderer.view.addEventListener("webglcontextrestored", this.onContextRestored);
  }

  async setup() {
    if (!this.running) return;
    this.timers = [];

    const profile = await this.manager.context.getOwnerProfile();
    if (!this.running) return;
    this.styles.updateAvatarUrl(profile.avatarUrl);

    if (await this.load() && this.running) {
      this.frame = this.ownerWindow.requestAnimationFrame(this.requestRenderTickReference);
    }
  }

  migrateWindow() {
    const next = this.renderer.view.ownerDocument.defaultView;
    if (!this.running || next === this.ownerWindow) return;
    this.ownerWindow.cancelAnimationFrame(this.frame);
    this.ownerWindow = next;
    this.lastRenderTick = next.performance.now();
    this.nodeEventHandler.setDocument(next.document);
    this.textAtlas.setDocument(next.document);
    void loadEmberlyFonts(next.document).then(() => { if (this.running) this.setTickDirty(); });
    if (this.isLoaded) this.frame = next.requestAnimationFrame(this.requestRenderTickReference);
    this.setTickDirty();
  }

  resetRenderTimer() {
    this.renderTimer = 0;
  }

  requestRenderTick(time) {
    // TODO chrome will set us to 30 fps for a few seconds when starting the rendering process. maybe 
    if (this.running) {
      let delta = (time - this.lastRenderTick) / 1000;
      this.lastRenderTick = time;

      if (this.closed) {
        if (this.alpha === 0) {
          this.destroy();
          return;
        } else if (delta < 0.25) {
          this.setAlpha(this.alpha * (1 - delta * 3) - delta);
          this.tickDirty = true;
        }
      } else if (!this.opened && delta < 0.25) {
        this.linkRenderer.onLoaded();
        this.setAlphaGeared(this.alpha * (1 + delta) + delta);
        this.opened = this.alpha === 1;
        this.tickDirty = true;
      }

      if (this.tickDirty || this.dirty || this.viewport.moving || this.viewport.zooming || this.nodeEventHandler.dirty) {
        this.tick(delta);
        this.renderer.render(this.viewport.parent);
        this.renderTimer = 0;
      } else if (this.renderTimer < 60) {
        this.tick(delta);
        this.renderer.render(this.viewport.parent);
        this.renderTimer++;
      }

      this.frame = this.ownerWindow.requestAnimationFrame(this.requestRenderTickReference);
    }
  }

  tick(delta) {
    if (this.dirty) {
      this.updateLayout();
    } else if (delta < 0.5 || !this.tickDirty) {
      const len = this.nodes.length;
      let i = 0;
      let dirtyNodes = false;

      this.nodeEventHandler.onTick(delta);

      for (; i < len; i++) {
        let node = this.nodes[i];
        node.onTick(delta);
        dirtyNodes = dirtyNodes || (node.dirty && node.isVisible);
      }

      this.nodeEventHandler.render(delta);

      if (dirtyNodes) {
        this.linkRenderer.render();
      }

      this.tickDirty = dirtyNodes;
    }
  }

  setTickDirty() {
    this.tickDirty = true;
  }

  close(isSwitch) {
    if (!isSwitch) {
      initialLoad = false;
    }

    this.closed = true;
    const visibleSum = TreeRenderer.SumVisibleNodes(this.nodes);

    if (visibleSum > MAX_ANIMATED) {
      this.nodes.forEach(t => {
        if (!t.isRoot && t.isVisible) {
          t.dirty = true;
        }
      });
    } else {
      this.nodes.forEach(t => {
        if (!t.isRoot && t.isVisible) {
          t.optimalPositionX = 0;
          t.optimalPositionY = t.optimalPositionY * 0.05;
          t.dirty = true;
        }
      });
    }
    this.removeAllListeners();
    this.setTickDirty();
  }

  destroy() {
    if (!this.running) return;
    try {
      this.running = false;
      this.ownerWindow.cancelAnimationFrame(this.frame);
      this.renderer.view.removeEventListener("webglcontextrestored", this.onContextRestored);

      this.manager.externalEvents
        .off(this.manager.getGlobalEventKey("updated"), this.onNodeUpdated)
        .off(this.manager.getGlobalEventKey("deleted"), this.onNodeDeleted)
        .off(this.manager.getGlobalEventKey("created"), this.onNodeCreated);

      this.nodes.forEach(t => {
        this.viewport.removeChild(t.container);
        if (!!t.renderText) {
          this.viewport.removeChild(t.renderText);
        }
      });

      this.viewport.removeChild(this.linkRenderer.container);

      this.nodes.forEach(node => node.destroy());

      this.removeAllListeners();
      this.nodeEventHandler.destroy();
      this.linkRenderer.destroy();

      if (this.root) {
        this.root.children = [];
        this.root.leftTree = null;
        this.root.rightTree = null;
      }
      this.textAtlas.destroy();


      this.renderer.render(this.viewport.parent);
      this.renderer = null;
      this.nodes = [];
      this.nodeDictionary.clear();

      this.manager = null;
      this.nodeEventHandler = null;


    } catch (err) {
      console.error("Could not destroy Pixi application", err);
    }
  }

  async load(skipAnimations = false) {
    if (await this.manager.loadEverything(true) && this.running) {

      const list = TreeHelper.GetOrderedTreeByReference(this.manager.entityIndex);

      this.manager.externalEvents
        .on(this.manager.getGlobalEventKey("updated"), this.onNodeUpdated)
        .on(this.manager.getGlobalEventKey("deleted"), this.onNodeDeleted)
        .on(this.manager.getGlobalEventKey("created"), this.onNodeCreated);

      const rootEntity = list[0];

      this.root = new RootNode(rootEntity, this, new RootLayout(rootEntity.side));
      this.root.container.zIndex = 99999999;
      this.root.isVisible = this.isFullTree();
      this.root.setGlobalPosition(this.worldWidth / 2, this.worldHeight / 2);
      this.root.setPosition(this.root.optimalPositionX, this.root.optimalPositionY);
      this.root.render();
      this.nodes = [];

      this.addChild(this.root);
      let nodes = [];

      // load nodes
      for (let i = 1; i < list.length; i++) {
        const n = new InteractiveNode(list[i], this, new ClusterLayout());
        nodes.push(n);
        this.nodeDictionary.set(n.id, n);
      }

      for (let i = 0; i < nodes.length; i++) {
        let node = nodes[i];
        let parentId = node.entity.parentId;
        let parent = this.nodeDictionary.has(parentId) ? this.nodeDictionary.get(parentId) : (node.entity.depth === 1 ? this.root : null);

        if (parent === null) {
          this.addToParentBuffer(parentId, node.id);
          parent = this.root;
        }

        parent.addChild(node, node.side);

        if (node.depth === 1 && node.color === -1) {
          node.color = this.styles.getSynapseColor(node.indexInParent, node.parent.layout.getSide());
          node.desaturateColor();
        }
      }

      if (this.isLoaded) {
        this.nodeEventHandler.setActiveNodeId(this.nodeEventHandler.activeNodeId, true);
      }

      this.updateLayout();
      this.nodes.sort((a, b) => (a.indexInParent - b.indexInParent) + (a.depth - b.depth) * 1000000);
      this.updateLayerOrder();

      const visibleSum = TreeRenderer.SumVisibleNodes(nodes);
      const performSkip = skipAnimations || initialLoad === false || visibleSum > MAX_ANIMATED;

      if (performSkip) {
        this.skipAnimations();
      }

      initialLoad = true;
      this.isLoaded = true;
      this.emit("onLoad", this, performSkip);


      return true;
    }

    return false;
  }

  async saveScreenshot(resolutionX = 1200, resolutionY = 675, padding = 0.9, background = "#F5F7F6", resolutionOverride = null, changeTheme = true) {
    const file = await this.capturePreview(resolutionX, resolutionY, padding, background, resolutionOverride, changeTheme);

    if (file) {
      const url = URL.createObjectURL(file);
      const a = this.ownerWindow.document.createElement("a");
      this.ownerWindow.document.body.append(a);
      a.download = "map";
      a.href = url;
      a.click();
      a.remove();
      this.ownerWindow.setTimeout(() => URL.revokeObjectURL(url), 0);
    } else {
    }
  }

  async capturePreview(resolutionX = 600, resolutionY = 338, padding = 0.9, background = "#F5F7F6", resolutionOverride = null, changeTheme = true) {
    const darkMode = this.themeMode === "dark";
    const color = this.renderer.backgroundColor;
    let canvas = null;

    try {
      if (darkMode && changeTheme) {
        this.setThemeMode("light", 0xF5F7F6, false);
      }

      canvas = renderToCanvas(this.renderer, this.viewport, this.root.getAABB(), Math.max(resolutionX, resolutionY), resolutionOverride);
    } finally {
      if (darkMode && changeTheme) {
        this.setThemeMode("dark", color, true);
      }
    }

    if (!canvas) return null;
    return ImageUtility.GeneratePreviewFromCanvasAsync(canvas, "preview.png", resolutionX, resolutionY, padding, background);
  }

  isPreviewCaptureReady() {
    return this.running && !this.closed && this.isLoaded && this.opened && !this.dirty && !this.tickDirty &&
      !this.viewport.moving && !this.viewport.zooming && !this.nodeEventHandler.dirty;
  }

  setThemeMode(mode = "light", backgroundColor = 0xF5F7F6, update = true) {
    this.themeMode = mode;
    this.renderer.backgroundColor = backgroundColor;
    this.root.updateColor();

    if (update) {
      this.dirty = true;
    }
  }

  createNode(entity) {
    // TODO move buffer, a map that adds a node to the correct parent once established?
    const node = new InteractiveNode(entity, this, new ClusterLayout());
   
    const hasParent = this.nodeDictionary.has(entity.parentId);
    let parent = hasParent ? this.nodeDictionary.get(entity.parentId) : this.root;
    parent.addChild(node, node.side);

    // Add to parentbuffer
    if (parent.id !== entity.parentId) {
      this.addToParentBuffer(entity.parentId, entity.id);
    }

    if (entity.color === -1 && parent.isRoot && hasParent) {
      const side = node.side !== 1 && node.side !== -1 ? node.parent.layout.getSide() : node.side;
      node.color = this.styles.getSynapseColor(node.indexInParent, side);
      entity.setColor(node.color);
      node.desaturateColor();
      node.render();
    }

    if (!this.dirty) {
      node.setLayoutDirty();
    }

    this.updateLayerOrder();

    if (this.parentBuffer.has(node.id)) {
      const set = this.parentBuffer.get(node.id);
      this.parentBuffer.delete(node.id);
      set.forEach(t => {
        const child = this.getNodeById(t);
        if (!!child) {
          child.move(node.id, null, null, false, false, true);
        }
      });
    }

    return node;
  }

  addChild(node) {
    this.nodes.push(node);
    this.viewport.addChild(node.container);
    if (!!node.renderText) {
      this.viewport.addChild(node.renderText);
    }
    this.nodeDictionary.set(node.id, node);
  }

  removeChild(node) {
    const idx = this.nodes.indexOf(node);
    if (idx !== -1) {
      this.nodes.splice(idx, 1);
      this.viewport.removeChild(node.container);
      if (!!node.renderText) {
        this.viewport.removeChild(node.renderText);
      }
    }
    this.nodeDictionary.delete(node.id);
  }

  deleteNodes(nodes) {
    const deleteSet = new Set();

    nodes.forEach(t => t.children.forEach(c => deleteSet.add(c.id)));
    nodes.forEach(t => deleteSet.delete(t.id));

    if (deleteSet.size !== 0) {
      const root = this.isFullTree() ? this.root : this.getBranchRoot();

      deleteSet.forEach(t => {
        const node = this.getNodeById(t);
        if (!!node) {
          node.move(root.id, null, null, false, false, false);
          this.addToParentBuffer(node.parent.id, node.id);
        }
      });
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      this.removeChild(node);
    }
  }

  addToParentBuffer(parentId, nodeId) {
    if (this.parentBuffer.has(parentId)) {
      this.parentBuffer.get(parentId).add(nodeId);
    } else {
      this.parentBuffer.set(parentId, new Set([nodeId]));
    }
    this.parentBufferLinks.set(nodeId, parentId);
  }

  removeFromParentBuffer(nodeId) {
    if (this.parentBufferLinks.has(nodeId)) {
      const parentId = this.parentBufferLinks.get(nodeId);
      this.parentBufferLinks.delete(nodeId);
      if (this.parentBuffer.has(parentId)) {
        this.parentBuffer.get(parentId).delete(nodeId);
      }
    }
  }

  setDirty(dirtySide) {
    if (!this.dirty || dirtySide !== this.dirtySide) {
      this.dirtySide = this.dirty && dirtySide !== this.dirtySide ? 0 : dirtySide;
      this.dirty = true;
      this.setTickDirty();
    }
  }

  updateLayout() {
    this.dirty = false;

    if (this.dirtySide <= 0) {
      this.root.leftTree.layout.updateWidth();
      this.root.leftTree.layout.update();
      this.root.leftTree.callRecursive(c => { c.dirty = true });
    }

    if (this.dirtySide >= 0) {
      this.root.rightTree.layout.updateWidth();
      this.root.rightTree.layout.update();
      this.root.rightTree.callRecursive(c => { c.dirty = true });
    }

    if (!this.mounted) {
      this.mounted = true;
      this.emit("onMounted", this);
    }
  }

  updateLayerOrder() {
    this.viewport.children.sort((a, b) => {
      a.zIndex = a.zIndex || 0;
      b.zIndex = b.zIndex || 0;
      return a.zIndex - b.zIndex;
    });
  }

  panTo(node, screenOffsetX, screenOffsetY, skipAnimations = false, time = 420) {

    if (!node || node.renderer.contextId !== this.contextId || node.id === "inbox") {
      return;
    }

    if (!node.isVisible || this.dirty) {
      this.updateLayout();
    }

    if (skipAnimations) {
      this.skipAnimations();
    }

    const { snapOptions } = this.styles;
    const { screenHeight, screenWidth } = this.viewport;

    const offsetX = screenOffsetX > screenWidth - 96 ? 0 : Math.min(screenOffsetX, screenWidth * 0.75);
    const offsetY = screenOffsetY > screenHeight - 96 ? 0 : Math.min(screenOffsetY, screenHeight * 0.75);

    if (screenHeight === offsetY || screenWidth === offsetX) {
      return;
    }

    const aabb = !node.isRoot && this.isFullTree() ? node.parent.getAABB() : node.getAABB();
    const point = aabb.getMidPoint();

    const width = aabb.getWidth();
    const height = aabb.getHeight();

    const actualWidth = Math.max(width, this.isEmbed ? 1250 : 2000);
    const actualHeight = Math.max(height, 1250);

    const hMul = (actualHeight / (screenHeight - offsetY));
    const wMul = (actualWidth / (screenWidth - offsetX));

    const worldOffsetX = wMul * (offsetX || 0);
    const worldOffsetY = -hMul * (offsetY || 0);

    const worldX = point.x + worldOffsetX * 0.5;
    const worldY = point.y - worldOffsetY * 0.5;

    this.viewport.snap(
      worldX,
      worldY,
      {
        ...snapOptions,
        time
      }
    );

    const ratio = (screenWidth - offsetX) / (screenHeight - offsetY);
    const aabbRatio = width / height;

    if (ratio < aabbRatio) {
      // landscape
      const zoomWidth = actualWidth * (screenWidth / (screenWidth - offsetX));
      this.viewport.snapZoom({
        width: zoomWidth + 32,
        ...snapOptions
      });
    } else {
      // portrait 
      const zoomHeight = actualHeight * (screenHeight / (screenHeight - offsetY));

      this.viewport.snapZoom({
        height: zoomHeight + 32,
        ...snapOptions
      });
    }

    this.setTickDirty();
  }

  zoom(direction) {
    const { snapOptions } = this.styles;
    // TODO add to existing zoom if already in zoom motion

    const level = this.viewport.zooming ? this.zoomWidthTarget : this.viewport.worldScreenWidth;
    const target = level - (direction * level) / (direction > 0 ? 2 : 1.25);
    this.zoomWidthTarget = target;

    this.viewport.snapZoom({
      width: target,
      ...snapOptions
    });
  }

  findClosestCallback(x, y, filter, radius) {
    const len = this.nodes.length;
    let minDist = 999999;
    let curNode = null;

    for (let i = 0; i < len; i++) {
      const node = this.nodes[i];

      let nX = node.getPositionX();
      let dX = x - nX;
      let dY = y - node.getPositionY();

      let distance = Math.sqrt(dX * dX + dY * dY);

      if (node.isVisible && distance < minDist && filter(node) && distance <= radius) {
        minDist = distance;
        curNode = node;
      }
    }

    return curNode;
  }


  findNode(x, y) {
    const len = this.nodes.length;

    for (let i = 0; i < len; i++) {
      const node = this.nodes[i];
      const nx = node.container.x;
      const ny = node.container.y;
      const nw = node.width / 2;
      const nh = node.height / 2;

      if (
        node.isVisible &&
        x >= nx - nw &&
        x <= nx + nw &&
        y >= ny - nh &&
        y <= ny + nh
      ) {
        return node;
      }
    }

    return null;
  }

  // TODO improve
  findClosestByOpposingJoints(node, radius) { // TODO fine tune, and make x-distance 0 if the bounding boxes intersect?
    const side = node.layout.getSide();

    const x = node.container.x - side * node.width * 0.5;
    const y = node.container.y;
    const len = this.nodes.length;
    let curNode = null;
    let minDist = 99999;

    for (let i = 0; i < len; i++) {
      const cN = this.nodes[i];

      if (cN.id === node.id || !cN.isVisible) {
        continue;
      }

      let cX = cN.container.x + side * cN.width * 0.5;
      let cY = cN.container.y;

      let intersectX = Math.abs(cN.container.x - node.container.x) < (cN.width + node.width) / 2;
      let dX = intersectX ? (x - cX) * 0.5 : x - cX;
      let dY = (y - cY) * 3;

      let dist = Math.sqrt(dX * dX + dY * dY);

      if (dist < minDist && dist <= radius && !cN.hasParent(node)) {
        minDist = dist;
        curNode = cN;
      }
    }

    if (curNode !== null && !curNode.isRoot) {
      const cX0 = node.container.x - side * node.width * 0.5;
      const cX1 = curNode.container.x + side * curNode.width * 0.5;
      const dX = (cX0 - cX1) * side;

      if (dX < 0) {
        curNode = curNode.parent;
        if (curNode.isRoot) {
          curNode = this.root;
        }
      }
    }

    if (curNode !== null && curNode.isRoot && !this.isFullTree()) {
      return null;
    }

    return curNode;
  }

  findInAABB(x0, y0, x1, y1, filter) {
    const len = this.nodes.length;
    let result = [];

    for (let i = 0; i < len; i++) {
      let node = this.nodes[i];

      if (node.id === filter.id || !node.isVisible) {
        continue;
      }

      const w05 = node.width / 2;
      const h05 = node.height / 2;
      const container = node.container;
      const cX0 = container.x - w05;
      const cY0 = container.y - h05;
      const cX1 = container.x + w05;
      const cY1 = container.y + h05;


      if (x0 > cX1 || cX0 > x1 || y0 > cY1 || cY0 > y1)
        continue;

      result.push(node);
    }

    return result;
  }

  getNodeById(nodeId) {
    if (this.nodeDictionary.has(nodeId)) {
      return this.nodeDictionary.get(nodeId);
    } else if (nodeId === "inbox") {
      return new InteractiveNode("inbox", "Inbox", this, null);
    }
    return null;
  }

  setDragEnabled(enabled) {
    if (this.running) {
      this.nodeEventHandler.setDragEnabled(enabled);
    }
  }

  setDragOverActive(active) {
    this.nodeEventHandler.setDragOverActive(active);
  }

  onDragOver(x, y) {
    this.nodeEventHandler.onDragOver(x, y);
  }

  pause() {
    this.viewport.pause = true;
  }

  resume() {
    this.viewport.pause = false;
  }

  skipAnimations() {
    this.alpha = 1;
    this.callWidthFirst(node => node.skipAnimations());
  }

  callDepthFirst(fn) {
    this.root.callRecursive(fn);
  }

  callWidthFirst(fn) {
    let node = this.root;
    let layer = [this.root].concat(this.root.leftTree.children).concat(this.root.rightTree.children);
    let buffer = [];

    do {
      buffer = layer;
      layer = [];

      for (let i = 0; i < buffer.length; i++) {
        node = buffer[i];
        fn(node);

        if (node.depth !== 0) {
          layer = layer.concat(node.children);
        }
      }
    }
    while (layer.length !== 0);
  }

  updateAvatarUrl(url) {
    if (this.styles.updateAvatarUrl(url) && this.running && !!this.root && this.isFullTree()) {
      this.root.updateAvatarUrl();
    }
  }

  getBranchRoot() {
    return this.nodes.find(node => node.parent !== null && node.parent.isRoot);
  }

  getActiveNode() {
    const id = this.nodeEventHandler.activeNodeId;

    if (this.nodeDictionary.has(id)) {
      const node = this.nodeDictionary.get(id);
      return node;
    } else {
      return this.root;
    }
  }

  isEmpty() {
    return !this.root || this.root.leftTree === null || this.root.rightTree === null || (this.root.leftTree.children.length === 0 && this.root.rightTree.children.length === 0);
  }

  isFullTree() {
    return !this.root || this.root.layout.side === 0;
  }

  canDisableFullTree() {
    return !!this.root && !!this.root.leftTree && !!this.root.rightTree && (this.root.leftTree.children.length + this.root.rightTree.children.length) <= 1;
  }

  setAlphaGeared(alpha) {
    const value = Math.min(1, Math.max(0, alpha));
    this.alpha = value;
    const len = this.nodes.length;

    for (let i = 0; i < len; i++) {
      const t = this.nodes[i];
      if (t.isVisible) {
        t.setAlpha(Math.min(1, value + (4 * value) / (t.depth * t.depth + 1)));
      }
    }
  }

  setAlpha(alpha) {
    const value = Math.min(1, Math.max(0, alpha));
    this.alpha = value;
    const len = this.nodes.length;

    for (let i = 0; i < len; i++) {
      const t = this.nodes[i];
      if (t.isVisible) {
        t.setAlpha(value);
      }
    }
  }

  setContextLost() {
    if (this.running && !this.closed) {
      this.nodeEventHandler.setContextLost();
    }
  }


  static SumVisibleNodes(nodes) {
    let sum = 0;
    for (let i = 0; i < nodes.length; i++) {
      sum += nodes[i].isVisible;
    }
    return sum;
  }


}
