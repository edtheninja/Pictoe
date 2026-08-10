import type { SourceImage } from "@/types/editor";

export const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export class ImageLoadError extends Error {}

export async function loadImageFile(file: File): Promise<SourceImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageLoadError(
      "Pictoe supports JPG, PNG and WebP images right now. Try another file.",
    );
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
    return {
      element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      name: file.name,
      type: file.type,
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}
