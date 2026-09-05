import { Rectangle } from "../pixi";
import NodeBase from "./NodeBase.js";
import DynamicText from "../text/DynamicText";
import DynamicTextStyle from "../text/DynamicTextStyle";

const FONT_H1 = new DynamicTextStyle();
FONT_H1.fontSize = 80;
FONT_H1.fontStyle = "normal";
FONT_H1.fontWeight = "600";

const FONT_H3 = new DynamicTextStyle();

const RATING_STRINGS = [
  "",
  "•",
  "••",
  "•••",
  "••••",
  "•••••"
];


export default class InteractiveNode extends NodeBase {

  constructor(entity, renderer, layout) {
    super(entity, renderer, layout);
    this.renderText = new DynamicText("", { style: FONT_H3, atlas: renderer.textAtlas });
    this.renderText.zIndex = 1000000;
    this.renderText.tint = 0x555;
    this.renderText.visible = false;
    this.container.hitArea = new Rectangle(0, 0, 0, 0);
    this.container.interactiveChildren = false;
  }

  onClick(ev) {
    if (this.isCollapsed) {
      const coords = this.renderer.viewport.toWorld(ev.data.global.x, ev.data.global.y);

      const offsetX = coords.x - this.container.x + this.width / 2;
      const dongleWidth = this.renderText.style.fontSize * 2.35;

      if (
        (this.side === 1 && offsetX > this.width - dongleWidth) ||
        (this.side === -1 && offsetX < dongleWidth)
      ) {
        if (this.renderer.manager.canEdit()) {
          this.entity.setIsCollapsed(false);
        } else {
          this.entity.isCollapsed = false;
          this.setIsCollapsed(false);
        }
      } else {
        this.renderer.emit("onNodeFocused", this);
      }
    } else {
      this.renderer.emit("onNodeFocused", this);
    }
  }

  onDoubleClick(ev) {
    this.renderer.emit("onNodeEdit", this);
  }

  onUpdateColor() {
    const index = this.indexInParent;
    if (this.entity.rgbColor !== null) {
      this.renderColor = this.entity.rgbColor;
    } else {
      const color = this.parent.renderColor;
      const mul = Math.sin(index * Math.PI / 4) * 6;
      let red = Math.max(0, Math.min(255, ((color >> 16) & 0xff) + mul));
      let green = Math.max(0, Math.min(255, ((color >> 8) & 0xff) + mul));
      let blue = Math.max(0, Math.min(255, (color & 0xff) + mul));
      this.renderColor = (red << 16) | (green << 8) | blue;
    }
      
    this.color = this.renderColor;
  }

  desaturateColor(f = 0.15, val = 0.8) {
    const color = this.entity.color;
    if (this.renderer.themeMode === "dark") {
      let red = Math.max(0, Math.min(255, ((color >> 16) & 0xff))) * val;
      let green = Math.max(0, Math.min(255, ((color >> 8) & 0xff))) * val;
      let blue = Math.max(0, Math.min(255, (color & 0xff))) * val;
      const L = 0.3 * red + 0.6 * green + 0.1* blue;
      this.renderColor = ((red + f * (L - red)) << 16) | ((green + f * (L - green)) << 8) | blue + f * (L - blue);
    } else {
      this.renderColor = color;
    }
  }


  getRatingString() {
    return RATING_STRINGS[Math.min(5, Math.max(0, this.entity.rating))];
  }

  getStateString() {
    const filter = this.entity.state & (this.renderer.root.entity.iconFilter ?? this.renderer.root.entity.state);
    const hasFlag = this.entity.state & 0b1 === 1;
    const hasHeart = (this.entity.state & 0b10) >> 1 === 1;
    const hasResources = (filter & 0b100) >> 2 === 1;
    const hasNotes = (filter & 0b1000) >> 3 === 1;
    return `${hasHeart ? "❤" : hasFlag ? "▨" : ""}${hasNotes ? "▤" : ""}${hasResources ? "▰" : ""}`;
  }

  setZIndex() {
    this.container.zIndex = 10000 - this.depth * 100 + this.indexInParent;
  }

  render() { // TODO Cleanup!!!
    this.container.clear();

    if (!this.isVisible) return;

    const selected = this.isSelected();
    const style = this.getTextStyle();
    const activeLink = this.hasActiveLink();

    this.container.zIndex = 10000 - this.depth * 100 + this.indexInParent;

    const decorations = `${this.getRatingString()}${this.getStateString()}`;
    const oldTextWidth = this.renderText.textWidth;
    const color = selected ? this.renderColor : activeLink ? this.renderer.linkRenderer.linkColor : this.renderColor;
    
    let isCollapsed = this.isCollapsed;

    if (!isCollapsed && this.entity.isCollapsed) {
      isCollapsed = this.renderer.nodeEventHandler.isTempVisible(this);
    }

    this.renderText.setTextAndStyle(
      `${isCollapsed && this.side === -1 ? "▱" : ""}${this.entity.name}${decorations}${isCollapsed && this.side === 1 ? "▱" : ""}`,
      style,
      this.renderer.themeMode === "dark" ? (activeLink ? 0x555555 : 0xDEDEDE) : (selected ? 0xF5F7F6 : 0x555555),
      color
    );


    this.renderText.visible = true;
    const isCategory = this.depth === 1;

    const fontSize = style.fontSize;
    const paddingH = fontSize * 0.15;
    const paddingW = fontSize * 0.4;

    const width = this.renderText.textWidth + paddingW * 2 - isCategory * 8;
    const height = fontSize + paddingH * 2;
    const height05 = height / 2;
    const width05 = width / 2;

    const offsetY = -height05 - 2;

    this.textOffsetX = -width05 + paddingW - (this.side === -1) * fontSize * 0.05 + isCategory * (this.side * 3 - 4);
    this.textOffsetY = offsetY;

    if (selected || activeLink) {
      this.container.beginFill(color, 1);
      const collapseOffset = isCollapsed * (isCategory ? 176 : 110);

      this.container.drawRoundedRect(
        -width05 + (this.side === -1) * (collapseOffset * 1.01),
        offsetY,
        width - collapseOffset,
        height
      );
    }

    this.width = width;
    this.height = height;
    this.container.hitArea.x = -width05 - this.side * isCollapsed * fontSize * (0.25 - (this.side === 1) * 0.15);
    this.container.hitArea.y = offsetY;
    this.container.hitArea.width = width - isCollapsed * fontSize * 0.325;
    this.container.hitArea.height = height;

    if (oldTextWidth !== 0) {
      const diff = this.renderText.textWidth - oldTextWidth;

      if (diff !== 0 && !!this.synapse) {
        this.container.x += diff * this.side * 0.5;

        if (this.side === -1) {
          this.renderText.x -= diff;
        }
        this.synapse.update();
        this.children.forEach(t => t.synapse.update());
      }
    }

    this.renderer.setTickDirty();
  }

  getWidth() {
    return this.width;
  }

  getHeight() {
    const fontSize = this.renderText.style.fontSize;
    return fontSize + fontSize * 0.3;
  }

  getPositionX() {
    const side = this.parent.layout.getSide();
    return this.parent.container.x + (this.optimalPositionX + (this.parent.width + this.width) / 2) * side;
  }

  // TODO override this one so we dont need branch here.
  getPositionY() {
    return this.parent === null ? this.optimalPositionY : this.parent.container.y + this.optimalPositionY;
  }

  getTextStyle() {
    return this.depth === 1 ? FONT_H1 : FONT_H3;
  }

  setPosition(x, y) {
    const container = this.container;
    const text = this.renderText;
    container.x = x;
    container.y = y;
    text.x = x + this.textOffsetX;
    text.y = y + this.textOffsetY;
  }

  
  setAlpha(alpha) {
    this.container.alpha = alpha;
    this.renderText.alpha = alpha;
  }

  setVisibility(visibility) {
    if (this.dragging && !visibility && this.renderer.nodeEventHandler?.draggingNode === this) return;
     
    this.isVisible = visibility;
    this.container.visible = visibility;
    this.renderText.visible = visibility;

    if (!this.isCollapsed) {
      this.children.forEach(c => c.setVisibility(visibility));
    }

    this.render();
  }

  destroy() {
    super.destroy();
    this.renderText.destroy();
  }
}
