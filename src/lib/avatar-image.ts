/**
 * Portrait encoding: a square 256 px WebP (JPEG where the browser can't encode WebP), stepped
 * down in quality until it fits the 64 KB upload limit.
 */
export const AVATAR_SIZE = 256;
export const AVATAR_MAX_BYTES = 64 * 1024;

/** Load a picked file as an image element (rejects non-images and very large files). */
export async function loadAvatarSource(file: File): Promise<HTMLImageElement> {
  if (!/^image\//.test(file.type)) throw new Error("avatar_type");
  if (file.size > 12 * 1024 * 1024) throw new Error("avatar_too_large");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("avatar_type");
  }
}

/** Draw the chosen square of the source (in source pixels) and encode it for upload. */
export async function encodeAvatar(image: CanvasImageSource, sx: number, sy: number, side: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("avatar_canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  for (const type of ["image/webp", "image/jpeg"]) {
    for (const quality of [.86, .76, .64, .5]) {
      const blob = await encode(type, quality);
      if (blob && blob.type === type && blob.size <= AVATAR_MAX_BYTES) return blob;
    }
  }
  throw new Error("avatar_too_large");
}
