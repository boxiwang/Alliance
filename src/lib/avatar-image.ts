/**
 * Turn a picked file into a small square portrait: centre-cropped, 256 px, WebP (JPEG where the
 * browser can't encode WebP), stepped down in quality until it fits the 64 KB upload limit.
 */
export const AVATAR_SIZE = 256;
export const AVATAR_MAX_BYTES = 64 * 1024;

export async function squareAvatarBlob(file: File): Promise<Blob> {
  if (!/^image\//.test(file.type)) throw new Error("avatar_type");
  if (file.size > 12 * 1024 * 1024) throw new Error("avatar_too_large");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("avatar_canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close?.();
  const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  for (const type of ["image/webp", "image/jpeg"]) {
    for (const quality of [.86, .76, .64, .5]) {
      const blob = await encode(type, quality);
      if (blob && blob.type === type && blob.size <= AVATAR_MAX_BYTES) return blob;
    }
  }
  throw new Error("avatar_too_large");
}
