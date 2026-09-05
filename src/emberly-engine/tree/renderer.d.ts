import type { EngineRenderer, EngineViewport } from "../engine-contract";

export function injectRenderer(size: { width: number; height: number }, container: HTMLElement,
  isMobile: boolean, backgroundColor: number): {
    renderer: EngineRenderer; viewport: EngineViewport; migrate(): void; dispose(): void;
  };
