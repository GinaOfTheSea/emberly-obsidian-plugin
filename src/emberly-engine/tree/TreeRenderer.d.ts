import type { EngineRenderer, EngineTree, EngineViewport } from "../engine-contract";
import type { MarkdownNodeCollection } from "../adapter/markdown-collection";

declare const TreeRenderer: new (id: string, readOnly: boolean, renderer: EngineRenderer,
  viewport: EngineViewport, collection: MarkdownNodeCollection, theme: "dark" | "light") => EngineTree;
export default TreeRenderer;
