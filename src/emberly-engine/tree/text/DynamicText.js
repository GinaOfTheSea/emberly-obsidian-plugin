import DynamicChar from "./DynamicChar";
import DynamicAtlas from "./DynamicAtlas";
import emojiRegex from "emoji-regex";
import { Sprite, Point, Container } from "../pixi";


/**
* An dynamic text object with auto generated atlas
*
* @class
* @extends PIXI.UI.UIBase
* @memberof PIXI.UI
* @param text {String} Text content
* @param [width=0] {Number|String} width of textbox. 0 = this.autoWidth
* @param [height=0] {Number|String} height of textbox. 0 = this.autoHeight
* @param [allowTags=true] {boolean} Allow inline styling
* @param [options=null] {} Additional text settings
*/

// TODO optimize, and remove everything we dont need.
// TODO use tint instead of two different styles for color when active.

const KNOWN_EMOJIS = new Set();


export default class DynamicText extends Container { // TODO extend container


  constructor(text, options) {
    super();
    this.options = options || {};

    // create atlas
    this.atlas = this.options.atlas || new DynamicAtlas(1);

    this.autoWidth = !this.options.width;

    // this._style for this textobject
    this._style = this.options.style;

    //this._style.merge(this.options.style); // TODO dont recreate this one.. to prevent recreate on setting style.

    // collection of all processed char
    this.chars = [];
    this.renderChars = [];
    this.spriteCache = []; 

    // the input text
    this._inputText = text;

    // states
    this.lastWidth = 0;
    this.lastHeight = 0;

    this.textWidth = 0;
    this.textHeight = 0;


    this.dirty = !!text;
    this.dirtyText = this.dirty;
    this.dirtyStyle = this.dirty;
    this.dirtyRender = this.dirty;

    // dictionary for line data
    this.lineFontSizeData = 0;
    this.lineAlignmentData = "left";

    this.renderCount = 0;
    this.charCount = 0;

    this.lazyUpdate = null;
    this.paintColor = 0xffffff;

    if (this.dirty) {
      this.updateImmediate();
    }
  }

  _render(renderer) {
    this.updateImmediate();
    super._render(renderer);
  }

  onRender() {
    let yOffset = this.lineHeightData;
    let xOffset = 0;
    let i;

    if (this.spriteCache.length > this.renderCount) {
      for (i = this.renderCount; i < this.spriteCache.length; i++) {
        const removeSprite = this.spriteCache[i];
        if (removeSprite) { 
          removeSprite.visible = false; 
        }
      }
    }

    let char;
    let lineWidth = this.lineWidthData;
    let lineHeight = this.lineHeightData;

    switch (this.lineAlignmentData) {
      case "right": xOffset = this._width - lineWidth; break;
      case "center": xOffset = (this._width - lineWidth) * 0.5; break;
      default: xOffset = 0;
    }

    for (i = 0; i < this.renderCount; i++) {
      char = this.renderChars[i];

      // no reason to render a blank space or 0x0 letters (no texture created)
      if (!char.data.texture || char.space) {
        if (this.spriteCache[i]) { this.spriteCache[i].visible = false; }
        continue;
      }

      // add new sprite
      const tex = char.data.texture;
      let sprite = this.spriteCache[i];

      if (!sprite) {
        sprite = this.spriteCache[i] = new Sprite(tex);
        sprite.anchor.set(0.5);
      } else { 
        sprite.texture = tex; 
      }

      sprite.visible = true;
      sprite.x = char.x + xOffset + tex.width * 0.5;
      sprite.y = char.y + yOffset - tex.height * 0.5 - (lineHeight - this.lineFontSizeData);
   
      sprite.tint = char.emoji ? 0xffffff : (char.paint ? this.paintColor : this.tint);
      sprite.rotation = float(char.style.rotation, 0);
      sprite.skew.x = float(char.style.skew, 0);
      
      if (!sprite.parent) {
        this.addChild(sprite);
      }
    }
    
    const inverseResolution = this._style.inverseResolution;
    this.scale.set(inverseResolution, inverseResolution);
    this.textWidth = lineWidth * inverseResolution;
    this.textHeight = lineHeight * inverseResolution;
  }

  prepareForRender() {
    const pos = new Point();
    let wordIndex = 0;
    let lineHeight = 0;
    let lineFontSize = 0;
    let lineAlignment = this._style.align;
    let style;
    let renderIndex = 0;
    let i;

    for (i = 0; i < this.charCount; i++) {
      const char = this.chars[i];

      style = char.style;

      // lineheight
      lineHeight = Math.max(lineHeight, this._style.lineHeight || style.lineHeight || char.data.lineHeight);

      // set word index
      if (char.space) {
        wordIndex++;
      } else {
        char.wordIndex = wordIndex;
      }

      // textheight
      lineFontSize = Math.max(lineFontSize, style.renderFontSize);

      // lineindex
      char.lineIndex = 0;

      // lineAlignment
      if (style.align !== this._style.align) lineAlignment = style.align;

      const size = Math.round(char.data.width) + float(style.letterSpacing, 0);
      
      // position
      char.x = pos.x + char.data.xOffset;
      char.y = parseFloat(style.verticalAlign) + char.data.yOffset;
      pos.x += size;
      this.renderChars[renderIndex] = char;
      renderIndex++;
    }

    const lastChar = this.chars[this.charCount - 1];

    if (lastChar) {
      pos.x -= lastChar.style.letterSpacing;
    }

    if (lastChar.space) {
      pos.x -= lastChar.data.width;
      pos.x -= float(style.letterSpacing, 0);
    }

    this.lineWidthData = pos.x;
    this.lineHeightData = lineHeight;
    this.lineFontSizeData = lineFontSize;
    this.lineAlignmentData = lineAlignment;
    this.renderCount = renderIndex;
  }

  processInputText() {
    let charIndex = 0;
    const regex = emojiRegex();
    const inputArray = Array.from(this._inputText);
    
    let match;
    let offset = 0;
   
    while ((match = regex.exec(this._inputText))) {
      const m = match[0];
      const size = [ ...m ].length;
      inputArray.splice(match.index - offset, size, m);
      KNOWN_EMOJIS.add(m);
      offset += size + (m.length - size) - 1;
    }

    for (let i = 0; i < inputArray.length; i++) {
      let c = inputArray[i];
      let char = this.chars[charIndex];
      
      if (!char) {
        char = new DynamicChar();
        this.chars[charIndex] = char;
      }

      char.style = this._style;
      char.data = this.atlas.getCharObject(c, char.style);
      char.value = c;
      char.space = c === " ";
      char.emoji = KNOWN_EMOJIS.has(c) || char.data.emoji;
      char.paint = !!char.data.paint;
      charIndex++;
    }
    
    this.charCount = charIndex;
  }

  update() {
    if (this.lazyUpdate !== null) return;
    this.lazyUpdate = setTimeout(() => {
      this.updateImmediate();
      this.lazyUpdate = null;
    }, 0);
  }

  updateImmediate() {

    if (this.dirtyText || this.dirtyStyle) {
      this.dirtyText = this.dirtyStyle = false;
      this.dirtyRender = true; // force render after textchange
      this.processInputText();
    }

    if (this.dirtyRender) {
      this.dirtyRender = false;
      this.dirty = false;
      this.lastWidth = this._width;
      this.lastHeight = this.height;
      this.prepareForRender();
      this.onRender();
    }
  }


  get value() {
    return this._inputText;
  }

  set value(val) {
    if (val !== this._inputText) {
      this._inputText = val;
      this.dirtyText = true;
      this.updateImmediate();
    }
  }

  get text() {
    return this.value;
  }

  set text(val) {
    this.value = val;
  }

  get style() {
    return this._style;
  }

  set style(val) {
    if (val !== this._style && this._inputText !== "") {
      this._style = val;
      this.dirtyStyle = true;
      this.updateImmediate();
    } else {
      this._style = val;
    }
  }

  setTextAndStyle(text, style, tint, paintColor) {
    this.dirtyText = (this._inputText !== text && !!text) || this.dirtyText;
    this.dirtyStyle = (this._style !== style && !!style) || this.dirtyStyle;

    if (this.dirtyText || this.dirtyStyle) {
      this.tint = tint;
      this.paintColor = paintColor;
      this._style = style || this.style; 
      this._inputText = text || this._inputText;
      this.updateImmediate();
    } else {
      this.setTint(tint, paintColor);
    }
  }

  setTint(tint, paintColor = 0xffffff) {
    if (this.tint !== tint || this.paintColor !== paintColor) {
      this.tint = tint;
      this.paintColor = paintColor;
  
      for (let i = 0; i < this.renderChars.length; i++) {
        const c = this.renderChars[i];
        const s = this.spriteCache[i];

        if (!!c.paint && !!s) {
          s.tint = paintColor;
        } else if (!c.emoji && !!s) {
          s.tint = tint;
        }
      }
    }
  }
}

// TODO DynamicText.prototype = Object.create(Widget.prototype);
//DynamicText.prototype.constructor = DynamicText;

DynamicText.settings = {
  debugSpriteSheet: false,
  defaultEmojiFont: "Segoe UI Emoji", // force one font family for emojis so we dont rerender them multiple times
};


// helper function for float or default
function float(val, def) {
  if (isNaN(val)) return def;

  return parseFloat(val);
}
