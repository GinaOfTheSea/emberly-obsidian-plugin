import { Sprite, Texture, Text, Graphics, TextStyle } from "../pixi";
import NodeBase from "./NodeBase";
import RootAttachmentNode from "./RootAttachmentNode";
import RootLayout from "../layouts/RootLayout";

export default class RootNode extends NodeBase {

  constructor(entity, renderer, layout) {
    super(entity, renderer, layout);
    this.avatar = null;
    this.leftTree = new RootAttachmentNode(entity, this.renderer, new RootLayout(-1), this);
    this.rightTree = new RootAttachmentNode(entity, this.renderer, new RootLayout(1), this);
    this.leftTree.side = -1;
    this.rightTree.side = 1;
    this.isRoot = true;
    this.mask = new Graphics();
    this.customText = null;
    this.textStyle = null;
    this.container.addChild(this.mask);
    this.container.alpha = 0;
    this.hasCustomText = false;
    this.hasCustomImage = false;
    this.customTextValue = "";
    this.customImageValue = "";
    this.avatarCleanup = null;
    this.state = entity.state;
    this.iconFilter = entity.iconFilter;
  }

  onClick() {
    this.renderer.emit("onRootFocused", this);
  }

  getSmallestSide() {
    const balance = Math.sign(this.leftTree.layout.width - this.rightTree.layout.width);

    if (balance !== 0)
      return balance;

    const count = Math.sign(this.leftTree.children.length - this.rightTree.children.length);
    return count === 0 ? 1 : count;
  }

  addChild(node, tree) {
    if (tree === 0 || tree === undefined) {
      tree = this.getSmallestSide();
    }

    const isBranch = this.layout.side === 1;

    if (isBranch) {
      const count = this.leftTree.children.length + this.rightTree.children.length;
      if (count !== 0) {
        this.entity.setFullTree(true);
      }
    }

    if (tree === -1) {
      this.leftTree.addChild(node);
    } else {
      this.rightTree.addChild(node);
    }
  }

  removeChild(node) {
    this.leftTree.removeChild(node);
    this.rightTree.removeChild(node);
  }

  render() {
    if (!this.renderer.running) return;
    
    this.container.zIndex = 20000;
    
    
    if (this.renderer.isFullTree()) {
      const centerName = this.entity.centerName ?? this.entity.name;
      this.hasCustomText = centerName.startsWith("TXT://");
      this.hasCustomImage = centerName.startsWith("IMG://");
      
      const customValue = this.hasCustomText || this.hasCustomImage ? centerName.substr(6) : null;

      if (this.avatar && (this.hasCustomText || customValue !== this.customImageValue)) {
        this.clearAvatar();
      }

      if (!this.hasCustomText && this.avatar === null) { 
        this.customImageValue = customValue;
        const avatar = this.hasCustomImage ? Texture.from(customValue) : this.renderer.styles.avatar;
        
        if (this.customText !== null) {
          this.container.removeChild(this.customText);
          this.customText.destroy();
          this.customText = null;
        }

        // Avatar Background
        let width = this.getWidth();
        const offset = width / 2;
        this.mask.clear();
        this.mask.x = -offset;
        this.mask.y = -offset;
        this.mask.beginFill(0xffffff, 1);
        this.mask.drawCircle(width / 2, width / 2, width / 2);
        this.mask.endFill();
        this.mask.zIndex = 1;

        this.avatar = new Sprite(avatar);
        this.avatar.anchor.set(0.5);
        this.avatar.mask = this.mask;
        this.avatar.zIndex = 2;

        this.container.addChild(this.avatar);

        this.watchAvatar(avatar, width);

        this.width = width;
        this.height = width;

      } else if (this.hasCustomText) {
        // Text background
        this.customTextValue = customValue;

        if (this.textStyle === null) {
          this.textStyle = new TextStyle({
            fontFamily: `"IBM Plex Sans", sans-serif`,
            fontSize: 100,
            fontStyle: "normal",
            fontWeight: "600",
            fill: [this.renderer.themeMode === "dark" ? "#DEDEDE" : "#555"],
            wordWrap: true,
            breakWords: true,
            wordWrapWidth: 1000,
            align: "center"
          });
        }

        if (this.customText === null) {
          if (this.avatar !== null) {
            this.clearAvatar();
            this.mask.clear();
          }
          this.customText = new Text(this.customTextValue, this.textStyle);
          this.container.addChild(this.customText);
        } else {
          this.customText.text = this.customTextValue;
        }

        this.width = this.customText.width + 150;
        this.height = this.customText.height + 150;
        this.customText.x = -this.customText.width / 2;
        this.customText.y = (-this.customText.height / 2) - 12;
      }
    } else {
      this.width = 1;
      this.height = 1;

      if (!!this.avatar) {
        this.clearAvatar();
        this.mask.clear();
      }

      if (!!this.customText) {
        this.container.removeChild(this.customText);
        this.customText.destroy();
        this.customText = null;
      }
    }

    this.leftTree.render();
    this.rightTree.render();
  }

  updateColor() {
    if (!!this.customText) {
      this.customText.style.fill = this.renderer.themeMode === "dark" ? 0xDEDEDE : 0x555555;
    }
    
    this.leftTree.updateColor();
    this.rightTree.updateColor();
  }

  updateAvatarUrl() {
    if (!this.renderer.running) return;
    this.clearAvatar();
    this.render();
    this.renderer.setTickDirty();
  }

  clearAvatar() {
    this.avatarCleanup?.();
    this.avatarCleanup = null;
    if (this.avatar) {
      this.container.removeChild(this.avatar);
      this.avatar.destroy();
      this.avatar = null;
      this.mask.clear();
    }
  }

  watchAvatar(texture, width) {
    const sprite = this.avatar;
    const apply = () => {
      if (!this.renderer.running || this.avatar !== sprite) return;
      // Legacy's round center, with a centered crop instead of stretching photos.
      const source = sprite.texture;
      sprite.scale.set(Math.max(width / Math.max(1, source.width), width / Math.max(1, source.height)));
      this.renderer.setTickDirty();
    };
    const fail = () => {
      if (!this.renderer.running || this.avatar !== sprite) return;
      sprite.texture = this.renderer.styles.avatar;
      apply();
    };
    texture.baseTexture.on("loaded", apply).on("error", fail);
    this.avatarCleanup = () => texture.baseTexture.off("loaded", apply).off("error", fail);
    apply();
  }

  destroy() {
    this.clearAvatar();
    if (this.customText) { this.customText.destroy(); this.customText = null; }
    super.destroy();
  }

  getWidth() {
    return this.renderer.isFullTree() ? this.renderer.styles.rootWidth : 1;
  }

  getDepth() {
    return Math.max(this.leftTree.getDepth(), this.rightTree.getDepth());
  }

  setPosition(x, y) {
    super.setPosition(x, y);
    this.leftTree.setPosition(x, y);
    this.rightTree.setPosition(x, y);
  }

  setGlobalPosition(x, y) {
    this.optimalPositionX = x;
    this.optimalPositionY = y;
    this.globalPositionX = x;
    this.globalPositionY = y;
    this.leftTree.globalPositionX = x;
    this.leftTree.globalPositionY = y;
    this.rightTree.globalPositionX = x;
    this.rightTree.globalPositionY = y;
  }

  subSetDirty() {
    this.dirty = true;
    this.leftTree.subSetDirty();
    this.rightTree.subSetDirty();
  }

  onTick(delta) {
    if (this.dirty) {
      const x = this.container.x;
      const y = this.container.y;
      this.leftTree.setPosition(x, y);
      this.rightTree.setPosition(x, y);
      super.onTick(delta);
    }
  }

  callRecursive(fn) {
    this.leftTree.callRecursive(fn);
    this.rightTree.callRecursive(fn);
  }

  fillAABB(aabb, maxDepth) {
    this.leftTree?.fillAABB(aabb, maxDepth);
    this.rightTree?.fillAABB(aabb, maxDepth);
  }

  // TODO override this one so we dont need branch here
  getPositionX() {
    return this.optimalPositionX;
  }

  // TODO override this one so we dont need branch here.
  getPositionY() {
    return this.optimalPositionY;
  }

  sortChildrenByEntity() {
    this.leftTree.sortChildrenByEntity();
    this.rightTree.sortChildrenByEntity();
  }

  onUpdated() {
    if (this.entity.side !== this.layout.side) {
      // change tree style
      const fullTree = this.entity.side === 0;
      this.layout.side = fullTree ? 0 : 1;
      this.container.visible = fullTree;
      this.isVisible = fullTree;
      this.container.alpha = 1;
      this.setLayoutDirty();
      this.renderer.nodes.filter(t => !!t.parent && t.parent.isRoot).forEach(t => {
        t.synapse.graphics.visible = fullTree;
      });
    }
    
    if (this.entity.state !== this.state || this.entity.iconFilter !== this.iconFilter) {
      this.state = this.entity.state;
      this.iconFilter = this.entity.iconFilter;
      this.renderer.nodes.forEach(t => {
        if (!t.isRoot) {
          t.render();
        }
      });
      this.setLayoutDirty();
    }

    const width = this.width, height = this.height;
    this.render();
    if (width !== this.width || height !== this.height) this.setLayoutDirty();
    this.setDirty();
    this.renderer.setTickDirty();
  }

}
