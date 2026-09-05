import { Graphics } from "../pixi";
import VecMath from "../common/VecMath";

export default class RasterSynapse {

  constructor(parent, child) {
    this.parent = parent;
    this.child = child;
    this.graphics = new Graphics();
    this.detached = false;
    this.attachTarget = parent;
  }

  render() {
     // TODO this one integrated into interactivenode, this one draws the box?

    const parent = this.detached ? this.attachTarget : this.parent;
    const g = this.graphics;
    
    // fetch container
    let pc = parent.container;
    let cc = this.child.container;
    
    // select joints
    const deltaX = pc.x - cc.x;
    const deltaY = pc.y - cc.y;

    const originX = Math.sign(deltaX) * this.child.width * 0.5;
    const destX = deltaX - Math.sign(deltaX) * parent.width * 0.5;
  
    const mid0X = originX + (destX - originX) / 1.5;
    const mid1X = destX - (destX - originX) / 2;

    let lineWidth = this.child.getTextStyle().fontSize * 0.4;
    let alpha = 1;
    
    if (this.child.dragging && !this.detached) {
      const side = this.child.layout.getSide();
      const pW05 = this.parent.width * 0.5;
      const cW05 = this.child.width * 0.5;

      const ccX = cc.x - side * cW05;
      const cX = this.parent.container.x + (this.child.optimalPositionX + pW05 + cW05) * side - side * cW05;
      const cY = this.child.getPositionY();
      
      const pX = parent.getPositionX() + side * pW05;
      const pY = parent.getPositionY();

      const neutralDistance = VecMath.Distance2F(pX, pY, cX, cY);
      const distanceFromParent = VecMath.Distance2F(pX, pY, ccX, cc.y);
      lineWidth *= Math.max(0.7, Math.min(1.5, 1.5 - 0.4*(distanceFromParent / neutralDistance)));

    } else if (this.detached){
      alpha = 0.5;
    }

    g.clear();
    g.lineStyle(lineWidth, this.child.renderColor, alpha);

    // draw the line
    g.moveTo(originX, 0);
    g.bezierCurveTo(
      mid0X, 0,
      mid1X, deltaY,
      destX, deltaY
    );
    
    const lineWidth05 = lineWidth / 2.0;
    g.lineStyle(0, this.child.renderColor);
    g.beginFill(this.child.renderColor);
    g.drawCircle(originX, 0, lineWidth05);
    
    const nextSibling = this.child.getNextSibling();

    if ((!nextSibling || this.child.dragging || nextSibling.dragging) && !this.detached) {
      if (!this.parent.entity?.isCollapsed) {
        g.drawCircle(destX, deltaY, lineWidth05);
      }
    } else if (this.detached) { 
      g.drawCircle(destX, deltaY, lineWidth05);
      this.drawDotOnParent();
    }
    
    g.endFill();
  }

  drawDotOnParent() {
    const children = this.parent.children;
    const len = children.length;
    const parentEntity = this.parent.entity;

    if (len > 1 && (!parentEntity || !parentEntity.isCollapsed) && this.parent.isVisible) {
      let pc = this.parent.container;
      let cc = this.child.container;
      // select joints
      const deltaX = pc.x - cc.x;
      const deltaY = pc.y - cc.y;
      let side = Math.sign(deltaX);

      if (this.parent.isRoot) {
        const index = this.child.indexInParent;
        
        if (index === len - 1) {
          const prev = children[index - 1];
          if (!!prev) {
            this.graphics.endFill();
            this.graphics.beginFill(prev.renderColor);
            side = Math.sign(pc.x - prev.container.x)
            
          }
        } else {
          return;
        }
      }

      const destX = deltaX - side * this.parent.width * 0.5;
      
      this.graphics.drawCircle(destX, deltaY, this.child.getTextStyle().fontSize * 0.2);
    }
  }

  setDetached(detached, attachTarget) {
    this.detached = detached;
    this.attachTarget = attachTarget || this.attachTarget;
  }

  invalidateNode(node) {
    if (this.detached) {
      if (this.attachTarget === node) {
        this.attachTarget = this.attachTarget.parent || null;
      }
      
      if (this.parent === node) {
        this.parent = node.parent || node.renderer.root;
      }
    }
  }

  update() {
    this.render();
  }
}