export type EmberlySide = "left" | "right" | "center";
export type EmberlyLayout = "center" | "branch";
export type EmberlyCenterMode = "avatar" | "text" | "image";
export interface MapIconVisibility { notes: boolean; resources: boolean; }
export interface EmberlyCenter {
  mode: EmberlyCenterMode;
  text?: string;
  image?: string;
  /** Derived local URL and warning; never persisted. */
  imageUrl?: string;
  issue?: string;
}

export interface SourceFile {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
  content?: string;
  hasNotes?: boolean;
}

export interface EmberlyNode {
  id: string;
  path: string;
  title: string;
  mapId: string;
  parentId: string | null;
  order: number | string;
  side: EmberlySide;
  color: number;
  collapsed: boolean;
  rating: number;
  state: number;
}

export interface EmberlyMap {
  format: number;
  id: string;
  path: string;
  folder: string;
  title: string;
  layout: EmberlyLayout;
  center?: EmberlyCenter;
  showIcons?: MapIconVisibility;
  nodes: EmberlyNode[];
  issues: string[];
}
