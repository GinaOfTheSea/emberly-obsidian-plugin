
export default class DynamicTextStyle {

  constructor(parent) {
    this.respectDirty = true;
    this._parent = parent || null;
    this._scale = 1;
    this._align = "left";
    this._fontFamily = `"IBM Plex Sans", sans-serif`;
    this._fontSize = 48;
    this._fontWeight = "normal";
    this._fontStyle = "normal";
    this._letterSpacing = 0;
    this._lineHeight = 0;
    this._verticalAlign = 0;
    this._rotation = 0;
    this._skew = 0;
    this._fill = "#fff";
    this._resolution = 2;
    this._inverseResolution = 0.5;
  }

  clone() {
    const style = new DynamicTextStyle();
    style.merge(this);
    return style;
  }

  merge(style) {
    if (typeof style === "object") {
      this.respectDirty = false;
      for (const param in style) {
        const val = style[param];

        if (typeof val === "function" || param === "respectDirty" || param === "_parent") continue;
        this[param] = style[param];
      }
      this.respectDirty = true;
      this._dirty = true;
    }
  }


  ctxKey(char) {
    return [char, this.fill, this.fontWeight, this.fontSize].join("|");
  }

  ctxFont() {
    const fontSize = `${Math.min(200, Math.max(1, this.renderFontSize || 26))}px`;
    return `${this.fontWeight} ${this.fontStyle} ${fontSize} ${this.fontFamily}`;
  }

  set _dirty(val) {
    if (this.respectDirty) {
      if (this._parent !== null) {
        this._parent.dirtyStyle = val;
        this._parent.update();
      }
    }
  }

  get scale() {
    return this._scale;
  }

  set scale(val) {
    if (val !== this._scale) {
      this._scale = val;
      this._dirty = true;
    }
  }

  get align() {
    return this._align;
  }

  set align(val) {
    if (val !== this._align) {
      this._align = val;
      this._dirty = true;
    }
  }

  get fontFamily() {
    return this._fontFamily;
  }

  set fontFamily(val) {
    if (val !== this._fontFamily) {
      this._fontFamily = val;
      this._dirty = true;
    }
  }

  get renderFontSize() {
    return this._fontSize * this._resolution;
  }

  get fontSize() {
    return this._fontSize;
  }

  set fontSize(val) {
    if (val !== this._fontSize) {
      this._fontSize = val;
      this._dirty = true;
    }
  }

  get fontWeight() {
    return this._fontWeight;
  }

  set fontWeight(val) {
    if (val !== this._fontWeight) {
      this._fontWeight = val;
      this._dirty = true;
    }
  }

  get fontStyle() {
    return this._fontStyle;
  }

  set fontStyle(val) {
    if (val !== this._fontStyle) {
      this._fontStyle = val;
      this._dirty = true;
    }
  }

  get letterSpacing() {
    return this._letterSpacing;
  }

  set letterSpacing(val) {
    if (val !== this._letterSpacing) {
      this._letterSpacing = val;
      this._dirty = true;
    }
  }

  get lineHeight() {
    return this._lineHeight;
  }

  set lineHeight(val) {
    if (val !== this._lineHeight) {
      this._lineHeight = val;
      this._dirty = true;
    }
  }

  get verticalAlign() {
    return this._verticalAlign;
  }

  set verticalAlign(val) {
    if (val !== this._verticalAlign) {
      this._verticalAlign = val;
      this._dirty = true;
    }
  }

  get rotation() {
    return this._rotation;
  }

  set rotation(val) {
    if (val !== this._rotation) {
      this._rotation = val;
      this._dirty = true;
    }
  }

  get skew() {
    return this._skew;
  }

  set skew(val) {
    if (val !== this._skew) {
      this._skew = val;
      this._dirty = true;
    }
  }

  get fill() {
    return this._fill;
  }

  set fill(val) {
    if (val !== this._fill) {
      this._fill = val;
      this._dirty = true;
    }
  }

  get resolution() {
    return this._resolution;
  }

  get inverseResolution() {
    return this._inverseResolution;
  }

  set resolution(val) {
    if (val !== this._resolution) {
      this._resolution = val;
      this._inverseResolution = 1 / val;
      this._dirty = true;
    }
  }

  

}
