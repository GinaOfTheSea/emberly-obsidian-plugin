import BaseLayout from "./BaseLayout";

export default class ClusterLayout extends BaseLayout {
  getSide() {
    return Math.sign(this.node.container.x - this.node.renderer.root.container.x);
  }

  getChildPosition(i) {
    const { layerSpacingWidth, layerSpacingHeight } = this.node.renderer.styles;

    return { 
      x: layerSpacingWidth * 2, 
      y: (this.node.children[i].layout.x - this.x) * layerSpacingHeight
    };
  }
}
