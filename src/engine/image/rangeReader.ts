/**
 * Reading a file a piece at a time, so a big PNG or WebP can be searched for its metadata chunk
 * without loading the whole picture. One interface, two backings: a Blob (the browser) and plain
 * bytes (tests and exported files already in memory).
 */
export type RangeReader = {
  readonly size: number;
  /** Up to `length` bytes from `offset`; fewer at the end of the file, none past it. */
  read(offset: number, length: number): Promise<Uint8Array>;
};

export function bytesReader(bytes: Uint8Array): RangeReader {
  return {
    size: bytes.length,
    read: async (offset, length) =>
      bytes.subarray(Math.max(0, offset), Math.max(0, offset) + length),
  };
}

export function blobReader(blob: Blob): RangeReader {
  return {
    size: blob.size,
    read: async (offset, length) =>
      new Uint8Array(
        await blob.slice(Math.max(0, offset), Math.max(0, offset) + length).arrayBuffer(),
      ),
  };
}
