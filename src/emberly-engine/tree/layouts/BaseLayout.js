
export default class BaseLayout {
  
  constructor() {
    this.node = null;
    this.x = 0;
    this.y = 0;
    this.span = 0;
    this.mod = 0;
    this.width = 0;
    this.height = 0;
  }

  getSide() {
    return 1;
  }

  getNodeSize() {
    return this.node.depth === 1 ? 1.5 : 0.75;
  }

  setNode(node) {
    this.node = node;
  }

  update() {
    const n = this.node;
    const children = n.children;
    const side = n.side;
    const w = n.width;

    for (let i = 0; i < children.length; i++) {
      const { x, y } = this.getChildPosition(i);
      const child = children[i];

      child.optimalPositionX = x;
      child.optimalPositionY = y;
      child.globalPositionX = n.globalPositionX + (x + (w + child.width) * 0.5) * side;
      child.globalPositionY = n.globalPositionY + y;
      child.layout.update();
    }
  }

  getMaxX() {
    const children = this.node.children;
    return children.length === 0 ? 1 : children[children.length - 1].layout.x;
  }

  updateWidth() {
    this.initializeNodes(0);
    this.calculateInitialX();
    this.calculateFinalPositions(0);
  }

  initializeNodes(depth) {
    const { nodeWidth, layerSpacingWidth } = this.node.renderer.styles;
    const width = this.node.width;
    this.x = -1;
    this.mod = 0;
    this.width = 0;
    this.height = 0;

    this.y = Math.floor(depth / (nodeWidth / 4)); 
    this.span = Math.max(1, Math.ceil(width / (nodeWidth / 4)) + 3);
    
    if (!this.node.isCollapsed) {
      const children = this.node.children;
      const len = children.length;
      for (let i = 0; i < len; i++) {
        children[i].layout.initializeNodes(depth + width + layerSpacingWidth);
      }
    }
  }

  calculateFinalPositions(modSum) {
    this.x += modSum;
    modSum += this.mod;

    if (this.node.isLeaf()) {
      this.width = this.x;
      this.height = this.y;
    } else {
     
      const children = this.node.children;
      const len = children.length;
      for (let i = 0; i < len; i++) {
        children[i].layout.calculateFinalPositions(modSum);
      }

      this.width = this.getMaxWidth();
      this.height = this.getMaxHeight();
    }
  }

  calculateInitialX() {
    if (this.node.isLeaf()) {
      if (!this.node.isLeftMost()) {
        this.x = this.node.getPreviousSibling().layout.x + this.getNodeSize();
      } else {
        this.x = 0;
      }
    } else if (this.node.children.length === 1) {
      
      const children = this.node.children;
      const len = children.length;
      for (let i = 0; i < len; i++) {
        children[i].layout.calculateInitialX();
      }

      if (this.node.isLeftMost()) {
        this.x = this.node.children[0].layout.x;
      } else {
        this.x = this.node.getPreviousSibling().layout.x + this.getNodeSize();
        this.mod = this.x - this.node.children[0].layout.x;
      }
    } else {

      const children = this.node.children;
      const len = children.length;
      for (let i = 0; i < len; i++) {
        children[i].layout.calculateInitialX();
      }

      let leftChild = this.node.getLeftMostChild();
      let rightChild = this.node.getRightMostChild();
      let mid = (leftChild.layout.x + rightChild.layout.x) / 2;

      if (this.node.isLeftMost()) {
        this.x = mid;
      } else {
        this.x = this.node.getPreviousSibling().layout.x + this.getNodeSize();
        this.mod = this.x - mid;
      }
    }

    if (!this.node.isLeftMost()) {
      this.checkForConflicts();
    }
  }

  checkForConflicts() {
    let sibling = this.node.getLeftMostSibling();
    
    if (sibling === null) {
      return;
    }

    const minDistance = 1.5 * this.getNodeSize(); // TODO mul here decided distance between trees
    let shiftValue = 0;

    let nodeContour = new Map();
    let siblingContour = new Map();
    this.getLeftContour(0, nodeContour);

    while (sibling !== null && sibling !== this.node) {
      
      siblingContour.clear();
      siblingContour.lastKey = 0;
      sibling.layout.getRightContour(0, siblingContour);

      let minDepth = Math.min(
        siblingContour.lastKey, 
        nodeContour.lastKey
      );

      let y0 = Math.min(
        sibling.layout.y + sibling.layout.span,  
        this.y + this.span
      ); // TODO this might need +1 on each

      for (let level = y0; level < minDepth; level++) {
        let distance = nodeContour.get(level) - siblingContour.get(level);

        if (distance + shiftValue < minDistance) {
          shiftValue = Math.max(minDistance - distance, shiftValue);
        }
      }
      
      // TODO moved this outside the loop? prioritize deeper nodes
      if (shiftValue > 0) {
        this.x += shiftValue;
        this.mod += shiftValue;
        shiftValue = 0;
        nodeContour.clear();
        nodeContour.lastKey = 0;
        this.getLeftContour(0, nodeContour);
      }

      sibling = sibling.getNextSibling();
    }
  }

  getLeftContour(modSum, values) {
    const len = this.y + this.span;

    for (let y = this.y; y <= len; y++) {
      if (!values.has(y)) {
        values.set(y, this.x + modSum);
      } else {
        values.set(y, Math.min(values.get(y), this.x + modSum));
      }
      values.lastKey = Math.max(y, values.lastKey || 0);
    }

    modSum += this.mod;
    if (!this.node.isLeaf()) {
      const children = this.node.children;
      const l = children.length;
      for (let i = 0; i < l; i++) {
        children[i].layout.getLeftContour(modSum, values);
      }
    }
  }

  getRightContour(modSum, values) {
    const len = this.y + this.span;
    
    for (let y = this.y; y <= len; y++) {
      if (!values.has(y)) {
        values.set(y, this.x + modSum);
      } else {
        values.set(y, Math.max(values.get(y), this.x + modSum));
      }
      values.lastKey = Math.max(y, values.lastKey || 0);
    }

    modSum += this.mod;
    if (!this.node.isLeaf()) {
      const children = this.node.children;
      const l = children.length;
      for (let i = 0; i < l; i++) {
        children[i].layout.getRightContour(modSum, values);
      }
    }
  }

  getLeftContourMin() {
    const children = this.node.children;
    let contour = this.x;

    for (let i = 0; i < children.length; i++) {
      contour = Math.min(contour, children[i].layout.getLeftContourMin());
    }

    return contour;
  }

  getRightContourMax() {
    const children = this.node.children;
    let contour = this.x;

    for (let i = 0; i < children.length; i++) {
      contour = Math.max(contour, children[i].layout.getRightContourMax());
    }

    return contour;
  }

  // utility methods

  getMaxWidth() {
    const children = this.node.children;
    let maxW = 0;

    for (let i = 0; i < children.length; i++) {
      let w = children[i].layout.width;
      maxW = Math.max(w, maxW);
    }

    return maxW;
  }

  getMaxHeight() {
    const children = this.node.children;
    let maxH = 0;

    for (let i = 0; i < children.length; i++) {
      let h = children[i].layout.height;
      maxH = Math.max(h, maxH);
    }

    return maxH;
  }
}
