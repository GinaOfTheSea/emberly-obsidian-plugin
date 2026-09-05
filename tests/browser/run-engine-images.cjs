const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const requests = [], errors = [];
    await context.route(/^https?:/, (route) => { requests.push(route.request().url()); return route.abort(); });
    await context.addInitScript(() => {
      window.fetchCalls = 0;
      window.fetch = () => { window.fetchCalls++; throw new Error("Unexpected fetch in offline renderer test"); };
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname, "engine-smoke.html")).href);
    await page.waitForFunction(() => window.emberlySmoke?.ok);
    const result = await page.evaluate(async () => {
      const { ImageResource, BaseTexture, Texture, Sprite, Container, Renderer, CanvasRenderer, ALPHA_MODES, SCALE_MODES, settings } = window.emberlyImages;
      const source = document.createElement("canvas");
      source.width = source.height = 4;
      const painter = source.getContext("2d");
      painter.fillStyle = "#ff0000"; painter.fillRect(0, 0, 2, 2);
      painter.fillStyle = "#0000ff"; painter.fillRect(2, 0, 2, 2);
      painter.fillStyle = "rgba(0,255,0,0.5)"; painter.fillRect(0, 2, 2, 2);
      const expected = Array.from(painter.getImageData(0, 0, 4, 4).data);
      const blob = await new Promise((resolve) => source.toBlob(resolve, "image/png"));
      const blobUrl = URL.createObjectURL(blob);
      const pixels = [];
      try {
        for (const src of [source.toDataURL(), blobUrl]) {
          for (const createBitmap of [false, true]) {
            for (const RendererType of [Renderer, CanvasRenderer]) {
              const image = new Image();
              image.src = src;
              await image.decode();
              const resource = new ImageResource(image, { autoLoad: false, createBitmap, alphaMode: ALPHA_MODES.UNPACK });
              // Default image loading and the optional bitmap path must both
              // work without calling fetch, even for an already loaded blob.
              await resource.load();
              const texture = new Texture(new BaseTexture(resource, { scaleMode: SCALE_MODES.NEAREST }));
              const stage = new Container();
              stage.addChild(new Sprite(texture));
              const renderer = new RendererType({ width: 4, height: 4, resolution: 1, backgroundAlpha: 0, preserveDrawingBuffer: true });
              renderer.render(stage);
              const copy = document.createElement("canvas");
              copy.width = copy.height = 4;
              const ctx = copy.getContext("2d");
              ctx.drawImage(renderer.view, 0, 0);
              pixels.push(Array.from(ctx.getImageData(0, 0, 4, 4).data));
              stage.destroy({ children: true, texture: true, baseTexture: true });
              renderer.destroy(true);
            }
          }
        }
        let adapterError;
        try { await settings.ADAPTER.fetch("https://example.invalid/unused-image.png"); }
        catch (error) { adapterError = error.message; }
        return { expected, pixels, adapterError, fetchCalls: window.fetchCalls };
      } finally { URL.revokeObjectURL(blobUrl); }
    });
    assert.equal(result.pixels.length, 8);
    for (const pixels of result.pixels) assert.deepEqual(pixels, result.expected, "Local image colors, alpha and dimensions remain unchanged");
    assert.match(result.adapterError, /Pixi network loading is disabled/);
    assert.equal(result.fetchCalls, 0);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    if (process.env.QA_OUTPUT) await page.screenshot({ path: path.join(process.env.QA_OUTPUT, "offline-map.png") });
    console.log("PASS: data/blob images render identical pixels in WebGL and Canvas, with bitmap mode on/off; zero fetch or HTTP requests");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
