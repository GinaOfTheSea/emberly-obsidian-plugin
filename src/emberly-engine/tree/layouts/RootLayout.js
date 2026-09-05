import BaseLayout from "./BaseLayout";

export default class RootLayout extends BaseLayout {

  constructor(side) {
    super();
    this.side = side;
  }

  getSide() {
    return this.side;
  }

  getChildPosition(i) {
    const { layerSpacingWidth, layerSpacingHeight } = this.node.renderer.styles;

    return { 
      x: layerSpacingWidth * (this.node.renderer.isFullTree() ? 5 : 0.1), 
      y: (this.node.children[i].layout.x - this.x) * layerSpacingHeight
    };
  }
}


