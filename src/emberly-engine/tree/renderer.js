import { settings, autoDetectRenderer, Container, Point } from "./pixi";
import { Viewport } from "pixi-viewport";
import PinchGesturePlugin from "./common/PinchGesturePlugin";
import { Ticker, UPDATE_PRIORITY } from "@pixi/ticker";
settings.PRECISION_FRAGMENT = "highp";

export function injectRenderer(size, container, isMobile, backgroundColor) {
  const worldWidth = 10000;
  const worldHeight = 10000;
  const width = size.width;
  const height = size.height;
  let ownerWindow = container.ownerDocument.defaultView;

  const renderer = autoDetectRenderer({
    view: container.ownerDocument.createElement("canvas"),
    width,
    height,
    backgroundColor: backgroundColor,
    resolution: getResolution(isMobile, ownerWindow),
    antialias: !isMobile && ownerWindow.devicePixelRatio < 2.5,
    autoDensity: true,
    powerPreference: "high-performance",
    backgroundAlpha: 1,
    useContextAlpha: false
  });

  container.appendChild(renderer.view);
  // Drive the existing Pixi ticker from the owning window, including while the
  // main Obsidian window is hidden. No gesture or animation constants change.
  const ticker = new Ticker();
  const interaction = renderer.plugins.interaction;
  interaction.useSystemTicker = false;
  ticker.add(interaction.tickerUpdate, interaction, UPDATE_PRIORITY.INTERACTION);
  
  const viewport = new Viewport({
    worldWidth,
    worldHeight,
    screenWidth: width,
    screenHeight: height,
    interaction: renderer.plugins.interaction,
    divWheel: container.ownerDocument.body,
    ticker,
  });

  const stage = new Container();
  stage.addChild(viewport);

  viewport
    .drag()
    .pinch()
    .wheel()
    .clampZoom({ minHeight: 500, maxHeight: worldHeight * 4 })
    .decelerate({
      friction: 0.85
    });

  const gesturePinch = new PinchGesturePlugin({ viewport, listenerNode: container.ownerDocument.body });
  viewport.plugins.add("gesture-pinch", gesturePinch);

  viewport.zoomPercent(-0.75);
  viewport.center = new Point(worldWidth / 2, worldHeight / 2);

  let frame;
  let disposed = false;
  const tick = (time) => {
    if (disposed) return;
    ticker.update(time);
    frame = ownerWindow.requestAnimationFrame(tick);
  };
  frame = ownerWindow.requestAnimationFrame(tick);
  const migrate = () => {
    const nextWindow = container.ownerDocument.defaultView;
    if (disposed || nextWindow === ownerWindow) return;
    ownerWindow.cancelAnimationFrame(frame);
    ownerWindow = nextWindow;
    ticker.lastTime = ownerWindow.performance.now();
    interaction.setTargetElement(renderer.view, renderer.resolution);
    viewport.options.divWheel.removeEventListener("wheel", viewport.input.wheelFunction);
    viewport.options.divWheel = container.ownerDocument.body;
    viewport.options.divWheel.addEventListener("wheel", viewport.input.wheelFunction, { passive: viewport.options.passiveWheel });
    gesturePinch.setListenerNode(container.ownerDocument.body);
    frame = ownerWindow.requestAnimationFrame(tick);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ownerWindow.cancelAnimationFrame(frame);
    gesturePinch.destroy();
    viewport.destroy({ children: true });
    ticker.destroy();
  };
  return { renderer, viewport, migrate, dispose };
}

const getResolution = (isMobile, ownerWindow) => {
  if (isMobile || ownerWindow.devicePixelRatio >= 2.5) {
    return Math.min(2.5, Math.max(ownerWindow.devicePixelRatio, 4.5));
  } else {
    const { width, height } = ownerWindow.screen;

    if (width * height <= 1920 * 1080) {
      return 1.5;
    } else if (width * height >= 2200 * 1200) {
      return 1.5;
    }

    return Math.min(1.5, Math.max(ownerWindow.devicePixelRatio, 1.75));
  }
};
