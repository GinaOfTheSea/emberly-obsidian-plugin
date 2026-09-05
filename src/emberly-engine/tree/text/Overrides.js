import DynamicCharOverride from "./DynamicCharOverride";
import { Rectangle } from "../pixi";

const overrides = [
  new DynamicCharOverride(
    "•",
    (style) => ({
      "rect": new Rectangle(
        style.fontSize * 0.175,
        -style.fontSize * 1.4,
        style.fontSize * 1.65,
        style.fontSize * 1.4
      ),
      "width": style.fontSize * 1.65,
      "descent": 1,
      "lineHeight": style.fontSize * 2,
      "emoji": true,
      "paint": false
    }),
    (g, obj, offsetX, offsetY) => {
      const fontSize = obj.fontSize;
      const radius = fontSize * 0.7;
      g.fillStyle = "#FFCF54";
      g.beginPath();
      g.arc(offsetX + radius + obj.rectX, offsetY - radius, radius, 0, 2 * Math.PI, false);
      g.fill();
    }
  ),
  new DynamicCharOverride(
    "❤",
    (style) => ({
      "rect": new Rectangle(
        style.fontSize * 0.25,
        -style.fontSize * 1.6,
        style.fontSize * 1.8,
        style.fontSize * 1.6
      ),
      "width": style.fontSize * 1.8,
      "descent": 1,
      "lineHeight": style.fontSize * 2,
      "emoji": true,
      "paint": false
    }),
    (g, obj, offsetX, offsetY) => {
      const w = obj.fontSize * 1.45;
      const h = obj.fontSize * 1.5;
      const radius = w * 0.5;

      drawHeart(g, offsetX + radius + obj.rectX, offsetY - h, w, h, "#FF3C38");
    }
  ),
  new DynamicCharOverride( // Flag
    "▨",
    (style) => ({
      "rect": new Rectangle(
        style.fontSize * 0.4,
        -style.fontSize * 1.4,
        style.fontSize * 1.6,
        style.fontSize * 1.4
      ),
      "width": style.fontSize * 1.6,
      "descent": 1,
      "lineHeight": style.fontSize * 2,
      "emoji": false,
      "paint": false
    }),
    (g, obj, offsetX, offsetY) => {
      const fontSize = obj.fontSize;
      const h = fontSize * 1.2;
      const radiusH = h * 0.5;
      const radiusW = h * 0.4;
      const lineWidth = fontSize * 0.15;
      const x = offsetX + obj.rectX + lineWidth / 2;
      const y = offsetY - h;
      const oldStrokeStyle = g.strokeStyle;
      g.strokeStyle = "#fff";
      g.lineWidth = lineWidth;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + radiusW, y);
      g.lineTo(x + radiusW + lineWidth / 4, y + lineWidth);
      g.lineTo(x + radiusW * 2, y + lineWidth);
      g.lineTo(x + radiusW * 2, y + lineWidth + radiusH);
      g.lineTo(x + radiusW + lineWidth / 4, y + lineWidth + radiusH);
      g.lineTo(x + radiusW, y + radiusH);
      g.lineTo(x, y + radiusH);
      g.lineTo(x, y + h);
      g.lineTo(x, y - lineWidth / 2);
      g.stroke();
      g.strokeStyle = oldStrokeStyle;
    }
  ),
  new DynamicCharOverride( // Notes
    "▤",
    (style) => ({
      "rect": new Rectangle(
        style.fontSize * 0.165,
        -style.fontSize * 1.45,
        style.fontSize * 1.65,
        style.fontSize * 1.4
      ),
      "width": style.fontSize * 1.65,
      "descent": 1,
      "lineHeight": style.fontSize * 2,
      "emoji": false,
      "paint": false
    }),
    (g, obj, offsetX, offsetY) => {
      const fontSize = obj.fontSize;
      const h = fontSize * 1.2;
      const radiusW = h * 1.1;
      const lineWidth = fontSize * 0.15;
      const x = offsetX + obj.rectX + lineWidth / 2;
      const y = offsetY - h + lineWidth;
      const oldStrokeStyle = g.strokeStyle;
      g.strokeStyle = "#fff";
      g.lineWidth = lineWidth;
      
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + radiusW, y);
      g.stroke();

      g.beginPath();
      g.moveTo(x, y + lineWidth * 2.5);
      g.lineTo(x + radiusW, y + lineWidth * 2.5);
      g.stroke();
      
      g.beginPath();
      g.moveTo(x, y + lineWidth * 5);
      g.lineTo(x + radiusW * 0.5, y + lineWidth * 5);
      g.stroke();

      g.strokeStyle = oldStrokeStyle;
    }
  ),
  new DynamicCharOverride( // Resources
    "▰",
    (style) => ({
      "rect": new Rectangle(
        style.fontSize * 0.1375,
        -style.fontSize * 1.5,
        style.fontSize * 1.65,
        style.fontSize * 1.4
      ),
      "width": style.fontSize * 1.65,
      "descent": 1,
      "lineHeight": style.fontSize * 2,
      "emoji": false,
      "paint": false
    }),
    (g, obj, offsetX, offsetY) => {
      const fontSize = obj.fontSize;
      const h = fontSize * 1.2;
      const unitW = fontSize / 6;
      const unitH = unitW * 0.75;
      const lineWidth = unitH;
      const x = offsetX + obj.rectX + fontSize * 0.15;
      const y = offsetY - h + lineWidth / 2;
      const oldStrokeStyle = g.strokeStyle;
      g.strokeStyle = "#fff";
      g.lineWidth = lineWidth;
      
      g.beginPath();
      g.moveTo(x + unitW * 6.5, y + unitH * 2);

      g.arc(
        x + unitW * 3.5, y + unitH * 3,
        unitH * 1,
        Math.PI * 1.5,
        Math.PI * 0.5,
        true
      );

      g.arc(
        x + unitW * 6.75, y + unitH * 2,
        unitH * 2,
        Math.PI * 2.5,
        Math.PI * 1.5,
        true
      );

      g.arc(
        x + unitW * 2.75, y + unitH * 3,
        unitH * 3,
        Math.PI * 1.5,
        Math.PI * 0.5,
        true
      );

      g.lineTo(x + unitW * 6.5, y + unitH * 6);
      g.stroke();

      g.strokeStyle = oldStrokeStyle;
    }
  ),
  new DynamicCharOverride( // Uncollapse Dongle
    "▱",
    (style) => ({
      "rect": new Rectangle(
        style.fontSize * 0.5,
        -style.fontSize * 1.3,
        style.fontSize * 4.35,
        style.fontSize * 1.3
      ),
      "width": style.fontSize * 4.35,
      "descent": 0,
      "lineHeight": style.fontSize * 2,
      "emoji": false,
      "paint": true
    }),
    (g, obj, offsetX, offsetY) => {
      const fontSize = obj.fontSize;
      const h = fontSize;
      const w = fontSize * 2.5;
      const r = h * 0.5;
      const y = offsetY - r - h * 0.2;

      g.fillStyle = "#ffffff";

      g.fillRect(
        offsetX + obj.rectX + r,
        offsetY - h - h * 0.2, 
        w, 
        h
      );

      g.beginPath();
      g.arc(offsetX + obj.rectX + r, y, r, 0, Math.PI * 2, false);
      g.fill();

      g.beginPath();
      g.arc(offsetX + obj.rectX + r + w, y, r, 0, Math.PI * 2, false);
      g.fill();

      const oldComposite = g.globalCompositeOperation;
      g.globalCompositeOperation = "destination-out";
      
      g.beginPath();
      g.arc(offsetX + obj.rectX + w * 0.05 + r, y, r * 0.55, 0, Math.PI * 2, false);
      g.fill();

      g.beginPath();
      g.arc(offsetX + obj.rectX + w * 0.5 + r, y, r * 0.55, 0, Math.PI * 2, false);
      g.fill();

      g.beginPath();
      g.arc(offsetX + obj.rectX + w * 0.95 + r, y, r * 0.55, 0, Math.PI * 2, false);
      g.fill();

      g.globalCompositeOperation = oldComposite;
    }
  )
];

// TODO render the heart and flag using canvas ops instead of painting the image


function drawHeart(ctx, fromx, fromy, lw, hlen, color) {

  const x = fromx;
  const y = fromy;
  const width = lw;
  const height = hlen;

  ctx.save();
  ctx.beginPath();
  const topCurveHeight = height * 0.4;
  ctx.moveTo(x, y + topCurveHeight - hlen * 0.1);

  // top left curve
  ctx.bezierCurveTo(
    x + lw * 0.05, y + hlen * 0.1, 
    x - width / 2, y, 
    x - width / 2, y + topCurveHeight
  );

  // bottom left curve
  ctx.bezierCurveTo(
    x - width / 2, y + (height + topCurveHeight) / 2, 
    x, y + height, 
    x, y + height
  );

  // bottom right curve
  ctx.bezierCurveTo(
    x, y + height, 
    x + width / 2, y + (height + topCurveHeight) / 2, 
    x + width / 2, y + topCurveHeight
  );

  // top right curve
  ctx.bezierCurveTo(
    x + width / 2, y, 
    x - lw * 0.05, y + hlen * 0.1, 
    x, y + topCurveHeight - hlen * 0.1
  );

  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

export default overrides;
