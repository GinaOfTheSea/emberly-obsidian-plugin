import { EmberlyEngineHost } from "../../src/emberly-engine/engine-host";
import type { EmberlyMap, EmberlyNode } from "../../src/shared/types";
import { BaseTexture, ImageResource, Renderer, Texture } from "@pixi/core";
import { Container } from "@pixi/display";
import { Sprite } from "@pixi/sprite";
import { CanvasRenderer } from "@pixi/canvas-renderer";
import { ALPHA_MODES, SCALE_MODES } from "@pixi/constants";
import { settings } from "@pixi/settings";

const imageHarness = { BaseTexture, ImageResource, Renderer, Texture, Container, Sprite, CanvasRenderer, ALPHA_MODES, SCALE_MODES, settings };
declare global { interface Window { emberlyImages: typeof imageHarness; } }
window.emberlyImages = imageHarness;

declare global { interface Window { emberlySmoke?: { ok: boolean; message: string }; } }

type HarnessTree = {
  viewport: { x: number; y: number; scale: { x: number }; toGlobal(point: { x: number; y: number }): { x: number; y: number } };
  root: { x: number; y: number };
  getNodeById(id: string): { x: number; y: number };
  renderer: { view: HTMLCanvasElement; gl?: WebGLRenderingContext };
  setContextLost(): void;
};
declare global { interface Window { emberlyHarness: {
  engine: EmberlyEngineHost;
  tree: HarnessTree;
  migrate(container?: HTMLElement): void;
  mount: HTMLElement;
  events: { focus: string[]; edit: string[]; writes: number };
  create(container: HTMLElement): EmberlyEngineHost;
}; } }

const node = (id: string, parentId: string | null, side: "left" | "right" | "center", order: number): EmberlyNode => ({
  id, parentId, side, order, path: `${id}.md`, title: id === "root" ? "Root" : `Topic ${id} ${id === "left" ? "🐦" : id === "right" ? "👨‍👩‍👧‍👦" : "🇳🇴👍🏽"}`,
  mapId: "smoke-map", color: -1, collapsed: false, rating: 0, state: 0,
});
const map: EmberlyMap = {
  id: "smoke-map", format: 2, path: "map.md", folder: "", title: "Engine smoke map", layout: "center", issues: [],
  nodes: [node("root", null, "center", 1), node("left", "root", "left", 1), node("right", "root", "right", 2), node("child", "right", "right", 1)],
};

const mount = document.querySelector<HTMLElement>("#mount")!;
const migrations = new WeakMap<HTMLElement, (win: Window) => unknown>();
// Standalone harness for the public DOM helpers supplied by Obsidian.
const prepare = (element: HTMLElement): void => {
  element.empty = () => element.replaceChildren();
  element.onWindowMigrated = (listener) => {
    migrations.set(element, listener);
    return () => { migrations.delete(element); };
  };
};
prepare(mount);
const events = { focus: [] as string[], edit: [] as string[], writes: 0 };
try {
  const engine = new EmberlyEngineHost(mount, map, {
    persist: () => { events.writes++; }, focus: (id) => { events.focus.push(id); }, edit: (id) => { events.edit.push(id); },
    loaded: () => {
      const canvas = mount.querySelector("canvas");
      engine.fit(); engine.zoom(1); engine.zoom(-1);
      const initial = engine.collapseState("right");
      const collapsed = engine.toggleCollapse("right");
      const expanded = engine.toggleCollapse("right");
      const controlsWork = initial?.collapsed === false && collapsed === true && expanded === false;
      window.emberlySmoke = canvas && controlsWork
        ? { ok: true, message: "Original Emberly renderer mounted and collapse controls responded" }
        : { ok: false, message: canvas ? "Collapse controls did not respond" : "Renderer produced no canvas" };
    },
  });
  window.emberlyHarness = {
    engine, mount, events,
    tree: (engine as unknown as { tree: HarnessTree }).tree,
    migrate: (element = mount) => { migrations.get(element)?.(element.ownerDocument.defaultView!); },
    create: (container) => {
      prepare(container);
      return new EmberlyEngineHost(container, map, { persist: () => undefined, focus: () => undefined, edit: () => undefined });
    },
  };
} catch (error) {
  window.emberlySmoke = { ok: false, message: error instanceof Error ? error.stack ?? error.message : String(error) };
}
