import { Texture } from "../pixi";

export default class RasterStyles {

  constructor() {
    this.rootWidth = 350;
    this.nodeWidth = 400;
    this.layerSpacingWidth = 150;
    this.layerSpacingHeight = 85;
    this.padding = 8;
    this.fontFamily = `"IBM Plex Sans", sans-serif`;

    this.snapOptions = {
      removeOnComplete: true,
      removeOnInterrupt: true,
      time: 500
    };

    this.avatarUrl = null;
    this.avatar = null;

    this.synapseColors = [
      0x0093D1, 0x77C0DF, 0x48AFDA
    ];
  }

  updateAvatarUrl(url) {
    const hasUpdate = url !== this.avatarUrl && !!url;
    if (hasUpdate) {
      this.avatar = Texture.from(url);
      this.avatarUrl = url;
    }
    return hasUpdate;
  }

  getSynapseColor(i, side) {
    const len = this.synapseColors.length;

    if (side === 1) {
      return this.synapseColors[len - (i % len) - 1];
    }

    return this.synapseColors[i % len];
  }
}