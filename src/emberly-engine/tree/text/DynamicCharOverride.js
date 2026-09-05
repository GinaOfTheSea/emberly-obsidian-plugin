
export default class DynamicCharOverride {

  constructor(char, optionsCallback, renderCallback) {
    this.char = char;
    this.optionsCallback = optionsCallback;
    this.renderCallback = renderCallback;
  }

  draw(context, obj, offsetX, offsetY) {
    this.renderCallback(context, obj, offsetX, offsetY);
  }

  getCharData(style) {
    return this.optionsCallback(style);
  }

}