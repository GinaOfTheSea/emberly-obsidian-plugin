import type { EmberlyCenter, EmberlyMap } from "../shared/types";

export type MapCenterChange = { mode: "avatar" } | { mode: "text"; text: string } | { mode: "image"; file: File };
export const CENTER_IMAGE_LIMIT = 20 * 1024 * 1024;
export const CENTER_IMAGE_EXTENSIONS = /^(png|jpe?g|gif|webp|avif)$/i;

export function readMapCenter(properties: Record<string, unknown>): EmberlyCenter {
  const mode = properties["emberly-center"];
  return {
    mode: mode === "text" || mode === "image" ? mode : "avatar",
    text: typeof properties["emberly-center-text"] === "string" ? properties["emberly-center-text"].trim() : undefined,
    image: typeof properties["emberly-center-image"] === "string" ? properties["emberly-center-image"].trim() : undefined,
  };
}

/** Renderer-only legacy encoding. Never change the root note's filename/title. */
export function mapCenterName(map: EmberlyMap): string {
  if (map.center?.mode === "text") return `TXT://${map.center.text || map.title}`;
  if (map.center?.mode === "image" && map.center.imageUrl) return `IMG://${map.center.imageUrl}`;
  return "root";
}
