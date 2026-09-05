import NodeBase from "./NodeBase";

export default class RootAttachmentNode extends NodeBase { // TODO not inherit from basenode ?

  constructor(entity, renderer, layout, root) {
    super(entity, renderer, layout);
    this.root = root;
    this.isRoot = true;
    this.container.interactiveChildren = false;
    this.container.interactive = false;
  }

  render() {
    this.width = this.root.width;
  }

  getWidth() {
    return this.renderer.styles.rootWidth;
  }

  getPositionX() {
    return this.root.optimalPositionX;
  }

  // TODO override this one so we dont need branch here.
  getPositionY() {
    return this.root.optimalPositionY;
  }
}