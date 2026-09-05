import { utils } from "../pixi";
const BYTES_PER_PIXEL = 4;

export function renderToCanvas(renderer, target, aabb, maxWidth = 1200, resolutionOverride = null) {
  if (!renderer.renderTexture) return null;

  const w = Math.ceil(aabb.getWidth());
  const h = Math.ceil(aabb.getHeight());
  const maxTextureSize = renderer?.context?.gl?.getParameter(renderer?.context?.gl?.MAX_TEXTURE_SIZE) || 4096;
  const m = Math.max(w, h);
  const s = Math.min(maxTextureSize * 0.95, maxWidth * 2) / m;

  const resolutionBase = Math.min(Math.max(0.2, s), 2.5);
  let renderTexture = renderer.generateTexture(target, { resolution: typeof resolutionOverride === "number" ? resolutionOverride : resolutionBase });
  let resolution = renderTexture.baseTexture.resolution;
  let frame = renderTexture.frame;
  renderer.renderTexture.bind(renderTexture);

  const width = Math.floor((frame.width * resolution) + 1e-4);
  const height = Math.floor((frame.height * resolution) + 1e-4);
  let canvasBuffer = new utils.CanvasRenderTarget(width, height, 1);
  const webglPixels = new Uint8Array(BYTES_PER_PIXEL * width * height);

  // read pixels to the array
  const gl = renderer.gl;
  gl.readPixels(
    frame.x * resolution,
    frame.y * resolution,
    width,
    height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    webglPixels
  );
  // add the pixels to the canvas
  const canvasData = canvasBuffer.context.getImageData(0, 0, width, height);
  const valid = arrayPostDivide(webglPixels, canvasData.data);
  
  canvasBuffer.context.putImageData(canvasData, 0, 0);
  renderTexture.destroy(true);
  
  return valid ? canvasBuffer.canvas : null;
}


function arrayPostDivide(pixels, out) {
  let empty = true;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = out[i + 3] = pixels[i + 3];
    if (alpha !== 0) {
      empty = false;
      out[i] = Math.round(Math.min(pixels[i] * 255.0 / alpha, 255.0));
      out[i + 1] = Math.round(Math.min(pixels[i + 1] * 255.0 / alpha, 255.0));
      out[i + 2] = Math.round(Math.min(pixels[i + 2] * 255.0 / alpha, 255.0));
    }
    else {
      out[i] = pixels[i];
      out[i + 1] = pixels[i + 1];
      out[i + 2] = pixels[i + 2];
    }
  }
  return !empty;
}