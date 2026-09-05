import { Rectangle, BaseTexture, CanvasResource, Texture } from "../pixi";
import DynamicText from "./DynamicText";
import DynamicTextStyle from "./DynamicTextStyle";
import Overrides from "./Overrides";
import TextMetrics from "./TextMetrics";


// TODO add resolution to style, and multiply rendered fontsize with it.
// http://homepages.math.uic.edu/~leon/mcs425-s08/handouts/char_freq2.pdf
export default class DynamicAtlas {

  constructor(padding, doc = document) {
    this.document = doc;
    this.metricsCanvas = doc.createElement("canvas");
    this.metricsContext = this.metricsCanvas.getContext("2d", { willReadFrequently: true });
    this.metricsCanvas.width = this.metricsCanvas.height = 100;
    this.baseTextures = [];
    this.padding = padding;
    this.canvas = null;
    this.context = null;
    this.objects = null;
    this.newObjects = [];
    this.baseTexture = null;
    this.lazyTimeout = null;
    this.rootNode = null;
    this.canvasList = [];
    this.atlasdim = 0;
    this.startdim = 1024;
    this.maxdim = 4096;
    this.fontFamilyCache = {};
    this.overrides = new Map();
    this.addCanvas();
  }

  setDocument(doc) {
    if (doc === this.document) return;
    this.document.defaultView.clearTimeout(this.lazyTimeout);
    this.lazyTimeout = null;
    if (this.newObjects.length) this.addNewObjects();
    doc.adoptNode(this.metricsCanvas);
    for (const canvas of this.canvasList) doc.adoptNode(canvas);
    this.document = doc;
  }

  destroy() {
    this.document.defaultView.clearTimeout(this.lazyTimeout);
    for (const texture of this.baseTextures) texture.destroy();
    this.baseTextures = [];
    this.newObjects = [];
    this.canvasList = [];
  }

  addCanvas() {
    // create new canvas
    this.canvas = this.document.createElement("canvas");
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
    this.canvasList.push(this.canvas);

    // reset dimentions
    this.atlasdim = this.startdim;
    this.canvas.width = this.canvas.height = this.atlasdim;
    this.rootNode = new AtlasNode(this.atlasdim, this.atlasdim);

    // reset array with canvas objects and create new atlas
    this.objects = [];

    // set new basetexture
    this.baseTexture = new BaseTexture(new CanvasResource(this.canvas));
    this.baseTextures.push(this.baseTexture);
    this.baseTexture.mipmap = false; // if not, pixi bug resizing POW2
    this.baseTexture.resolution = 1; // todo: support all resolutions
    this.baseTexture.update();

    // add char overrides
    Overrides.forEach(t => this.overrides.set(t.char, t));

    // Debug Spritesheet
    if (DynamicText.settings.debugSpriteSheet) {
      this.canvas.className = "DynamicText_SpriteSheet";
      this.document.body.appendChild(this.canvas);
    }
  }

  drawObjects(arr, resized) {
    if (resized) {
      this.baseTexture.update();
    }

    for (let i = 0; i < arr.length; i++) { this.drawObject(arr[i]); }

    if (resized) {
      for (let i = 0; i < this.objects.length; i++) {
        const obj = this.objects[i];
        if (!!obj.texture) {
          obj.texture.updateUvs();
        }
      }
    }
  }

  drawObject(obj) {
    const offsetX = obj.frame.x - obj.rectX;
    const offsetY = obj.frame.y - obj.rectY;

    if (this.overrides.has(obj.value)) {
      this.overrides.get(obj.value).draw(this.context, obj, offsetX, offsetY);
    } else {
      this.context.font = obj.font;
      this.context.fillStyle = obj.fill;
      this.context.fillText(obj.value, offsetX, offsetY);
    }

    obj.texture.frame = obj.frame;
    obj.texture.update();
  }

  getCharObject(char, style) {
    const font = style.ctxFont();

    // create new cache for fontFamily
    let familyCache = this.fontFamilyCache[font];

    if (!familyCache) {
      familyCache = {};
      this.fontFamilyCache[font] = familyCache;
    }

    // get char data
    const key = style.ctxKey(char);
    let obj = familyCache[key];

    if (!obj) {
      // create char object

      const metrics = !!TextMetrics[key] ? { ...TextMetrics[key] } : this.overrides.has(char) ? this.overrides.get(char).getCharData(style) : this.generateCharData(char, style);
      const hasRect = !!metrics.rect;

      // temp resize if doesnt fit (not nesseary when we dont need to generate textures)
      if (hasRect) {
        if (this.canvas.width < metrics.rect.width || this.canvas.height < metrics.rect.height) {
          this.canvas.width = this.canvas.height = Math.max(metrics.rect.width, metrics.rect.height);
          this.baseTexture.update();
        }
      }

      // todo: cleanup when we know whats needed
      obj = {
        metrics,
        font,
        emoji: !!metrics.emoji,
        paint: !!metrics.paint,
        value: char,
        // Packing mutates the frame. Keep the shared font metrics pristine so
        // another map's atlas retains the original glyph drawing offsets.
        frame: metrics.rect?.clone(),
        fill: style.fill,
        fontSize: style.fontSize,
        baseTexture: hasRect ? this.baseTexture : null,
        rectX: hasRect ? metrics.rect.x : 0,
        rectY: hasRect ? metrics.rect.y : 0,
        xOffset: hasRect ? metrics.rect.x : 0, // TODO merge with xOffset
        yOffset: metrics.descent || 0,
        width: metrics.width || 0,
        lineHeight: metrics.lineHeight || 0,
        texture: metrics.rect ? new Texture(this.baseTexture, metrics.rect) : null, // temp texture
      };

      // add to collections
      familyCache[key] = obj;

      // add to atlas if visible char
      if (hasRect) {
        this.newObjects.push(obj);

        if (this.lazyTimeout === null) {
          this.lazyTimeout = this.document.defaultView.setTimeout(() => {
            this.addNewObjects();
            this.lazyTimeout = null;
          }, 0);
        }
      }
    }

    return obj;
  }

  // TODO debug resize canvas
  addNewObjects() {
    this.newObjects.sort(compareFunction);
    let _resized = false;
    let _newcanvas = false;

    for (let i = 0; i < this.newObjects.length; i++) {
      const obj = this.newObjects[i];
      const node = this.rootNode.insert(obj.frame.width + this.padding, obj.frame.height + this.padding, obj);

      if (node !== null) {
        if (_newcanvas) obj.texture.baseTexture = this.baseTexture; // update this.basetexture if new canvas was created (temp)
        this.objects.push(obj);
        continue;
      }

      // step one back (so it will be added after resize/new canvas)
      i--;

      if (this.atlasdim < this.maxdim) {
        _resized = true;
        this.resizeCanvas(this.atlasdim * 2);
        continue;
      }

      // close current spritesheet and make a new one
      this.drawObjects(this.objects, _resized);
      this.addCanvas();
      _newcanvas = true;
      _resized = false;
    }

    this.drawObjects(_resized || _newcanvas ? this.objects : this.newObjects, _resized);
    this.newObjects = [];
  }

  resizeCanvas(dim) {
    this.canvas.width = this.canvas.height = this.atlasdim = dim;

    this.rootNode = new AtlasNode(dim, dim);
    this.objects.sort(compareFunction);

    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      this.rootNode.insert(obj.frame.width + this.padding, obj.frame.height + this.padding, obj);
    }
  };

  generateCharData(char, style) {
    const { metricsCanvas, metricsContext } = this;
    const fontSize = Math.max(1, int(style.renderFontSize, 26));
    const lineHeight = fontSize * 1.25;

    // Start our returnobject
    const data = {
      lineHeight,
      width: 0,
    };

    // Return if newline
    if (!char) { return data; }

    // Ctx font string
    const font = style.ctxFont();

    metricsContext.font = font;

    // Get char width
    data.width = Math.round(metricsContext.measureText(char).width);

    // Return if char = space
    if (char === " ") return data;

    // set canvas size (with this.padding so we can messure)
    const paddingY = Math.round(fontSize * 0.7);
    const paddingX = Math.max(5, Math.round(fontSize * 0.7));

    metricsCanvas.width = (Math.ceil(data.width) + paddingX * 2);
    metricsCanvas.height = 1.5 * fontSize;
    const w = metricsCanvas.width;
    const h = metricsCanvas.height;
    const baseline = (h / 2) + (paddingY * 0.5);

    // set font again after resize
    metricsContext.font = font;

    // make sure canvas is clean
    metricsContext.clearRect(0, 0, w, h);

    // save clean state with font
    metricsContext.save();

    // draw text
    //console.time("char get")
    metricsContext.fillStyle = style.fill;
    metricsContext.fillText(char, paddingX, baseline); // TODO use this with metrics to accelerate the paint later on, by doing this instead of copying the image
    metricsContext.restore();
    //console.timeEnd("char get")    

    // begin messuring
    // TODO TODO TODO to load faster, we can skip the entire measure, and dont fetch pixeldata if we simply pre-gen it for all common chars!
    const pixelData = metricsContext.getImageData(0, 0, w, h).data;

    let i = 3;
    const line = w * 4;
    const len = pixelData.length;

    // scanline on alpha
    while (i < len && !pixelData[i]) { i += 4; }

    const ascent = (i / line) | 0;

    if (i < len) {
      // rev scanline on alpha
      i = len - 1;
      while (i > 0 && !pixelData[i]) { i -= 4; }

      const descent = (i / line) | 0;

      // left to right scanline on alpha
      for (i = 3; i < len && !pixelData[i];) {
        i += line;
        if (i >= len) { i = (i - len) + 4; }
      }

      const minx = ((i % line) / 4) | 0;

      // right to left scanline on alpha
      let step = 1;

      for (i = len - 1; i >= 0 && !pixelData[i];) {
        i -= line;
        if (i < 0) { i = (len - 1) - (step++) * 4; }
      }

      const maxx = ((i % line) / 4) + 1 | 0;

      // set font metrics
      data.ascent = Math.round(baseline - ascent);
      data.descent = Math.round(descent - baseline);

      const finalMinX = minx - paddingX;
      const finalMaxX = maxx - paddingX;

      data.rect = new Rectangle(
        finalMinX,
        -data.ascent - 2,
        finalMaxX - finalMinX + 2,
        data.ascent + data.descent + 4,
      );
    }

    return data;
  }

  generateMetricsData() {
    const FONT_H1 = new DynamicTextStyle();
    FONT_H1.fontSize = 80;
    FONT_H1.fontStyle = "normal";
    FONT_H1.fontWeight = "600";

    const FONT_H3 = new DynamicTextStyle();
    const styles = [FONT_H1, FONT_H3];

    const tempCache = {};

    styles.forEach(style => {

      for (let i = 32; i < 127; i++) {
        const char = String.fromCharCode(i);
        const key = style.ctxKey(char);
        const data = this.generateCharData(char, style);

        tempCache[key] = {
          rect: data.rect,
          width: data.width,
          descent: data.descent,
          lineHeight: data.lineHeight
        };
      }
    });

  }

}

export class AtlasNode {

  constructor(w, h) {
    this.children = [];
    this.rect = new Rectangle(0, 0, w || 0, h || 0);
    this.data = null;
  }

  insert(width, height, obj) {

    if (this.children.length > 0) {
      const newNode = this.children[0].insert(width, height, obj);
      if (newNode !== null) return newNode;
      return this.children[1].insert(width, height, obj);
    }

    if (this.data !== null) return null;

    if (width > this.rect.width || height > this.rect.height) return null;

    if (width === this.rect.width && height === this.rect.height) {
      this.data = obj;
      obj.frame.x = this.rect.x;
      obj.frame.y = this.rect.y;
      return this;
    }

    this.children.push(new AtlasNode());
    this.children.push(new AtlasNode());

    const dw = this.rect.width - width;
    const dh = this.rect.height - height;

    if (dw > dh) {
      this.children[0].rect = new Rectangle(this.rect.x, this.rect.y, width, this.rect.height);
      this.children[1].rect = new Rectangle(this.rect.x + width, this.rect.y, this.rect.width - width, this.rect.height);
    }
    else {
      this.children[0].rect = new Rectangle(this.rect.x, this.rect.y, this.rect.width, height);
      this.children[1].rect = new Rectangle(this.rect.x, this.rect.y + height, this.rect.width, this.rect.height - height);
    }

    return this.children[0].insert(width, height, obj);
  }

}

// helper function for int or default
function int(val, def) {
  if (isNaN(val)) return def;

  return parseInt(val);
}

const compareFunction = function (a, b) {
  if (a.frame.height < b.frame.height) { return 1; }

  if (a.frame.height > b.frame.height) { return -1; }

  if (a.frame.width < b.frame.width) { return 1; }

  if (a.frame.width > b.frame.width) { return -1; }

  return 0;
};
