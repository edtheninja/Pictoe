/**
 * Saving the photo in the session without relying on IndexedDB being able to store a Blob.
 *
 * Normally the photo is stored as the Blob it came in as (no copy in memory). But some browsers
 * will not store a Blob in IndexedDB in some modes (WebKit throws "Error preparing Blob/File data
 * to be stored in object store" in private browsing, and in the ephemeral contexts Playwright
 * uses), while storing the same bytes as an ArrayBuffer works. So a save that fails with the Blob
 * is retried with the bytes, and a load accepts either. No DOM, so it can be tested.
 */

/** A saved session as stored: either the photo as a Blob, or as bytes plus its type. */
export type StoredPhoto = {
  imageBlob?: unknown;
  imageBytes?: unknown;
  /** The photo's MIME type, kept beside its bytes. */
  type: string;
};

/** The same record with the photo's Blob replaced by its bytes. */
export async function withBytes<T extends { imageBlob: Blob }>(
  session: T,
): Promise<Omit<T, "imageBlob"> & { imageBytes: ArrayBuffer }> {
  const { imageBlob, ...rest } = session;
  return { ...rest, imageBytes: await imageBlob.arrayBuffer() };
}

/**
 * The photo of a stored record as a Blob, from whichever form it was saved in, or null when it
 * has neither (a damaged record).
 */
export function photoBlob(stored: StoredPhoto): Blob | null {
  if (stored.imageBlob instanceof Blob) return stored.imageBlob;
  const bytes = stored.imageBytes;
  if (bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes)) {
    return new Blob([bytes as BlobPart], { type: stored.type });
  }
  return null;
}
