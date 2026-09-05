import { CENTER_IMAGE_LIMIT } from "./map-center";
import { imageExtension } from "../resources/resource-create";
import { fileNameParts } from "../vault/vault-files";

/** Validate raster input before writing; retain original bytes in the vault. */
export async function prepareCenterImage(file: File): Promise<{ bytes: ArrayBuffer; extension: string; stem: string }> {
  if (!file.size || file.size > CENTER_IMAGE_LIMIT) throw new Error("Choose an image up to 20 MiB.");
  const extension = await imageExtension(file);
  if (!extension) throw new Error("Choose a PNG, JPEG, GIF, WebP or AVIF image.");
  const bytes = await file.arrayBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: `image/${extension === "jpg" ? "jpeg" : extension}` }));
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      const finish = (error?: Error) => {
        window.clearTimeout(timer);
        image.onload = image.onerror = null;
        image.removeAttribute("src");
        if (error) reject(error); else resolve();
      };
      const timer = window.setTimeout(() => finish(new Error("The image took too long to load. Choose a smaller image.")), 10000);
      image.onload = () => finish(!image.naturalWidth || !image.naturalHeight
        || Math.max(image.naturalWidth, image.naturalHeight) > 8192 || image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024
        ? new Error("Choose an image no larger than 8192 pixels per side and 32 megapixels.") : undefined);
      image.onerror = () => finish(new Error("This image could not be decoded. Choose another image."));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
  return { bytes, extension, stem: fileNameParts(file.name).stem };
}
