import type { SourceImage } from "@/types/editor";
import { checkImageSize, readImageSize } from "./limits";

export const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export class ImageLoadError extends Error {}

export async function loadImageFile(file: File): Promise<SourceImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageLoadError(
      "Pictoe supports JPG, PNG and WebP images right now. Try another file.",
    );
  }

  // Check the size from the file header first, so a huge (or deliberately misleading) image is
  // refused before the browser tries to decode it.
  const header = readImageSize(new Uint8Array(await file.slice(0, 262144).arrayBuffer()));
  if (header) {
    const check = checkImageSize(header.width, header.height);
    if (!check.ok) throw new ImageLoadError(check.message);
  }

  const url = URL.createObjectURL(file);
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(
          new ImageLoadError(
            "Pictoe couldn't open this image. It may be damaged — try another one.",
          ),
        );
      img.src = url;
    });
    // Unrecognised headers fall through to here, so the real size is checked once more.
    const decoded = checkImageSize(element.naturalWidth, element.naturalHeight);
    if (!decoded.ok) throw new ImageLoadError(decoded.message);
    return {
      element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      name: file.name,
      type: file.type,
      blob: file, //File extends Blob, so this is free - just threading it through
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}
