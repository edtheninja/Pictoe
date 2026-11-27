/**
 * Photo info: the EXIF data of a JPEG (camera, lens, exposure, date, artist, copyright, and
 * optionally location), read from the original file and written into an exported JPEG.
 *
 * Exporting through a canvas drops all metadata, which is private by default. This is the opt-in
 * way back, and it is built to leak nothing by accident:
 * - It is an ALLOWLIST. Only the tags named below are ever copied. Everything else (maker notes,
 *   serial numbers, owner name, unique image id, the embedded thumbnail, XMP, IPTC, the software
 *   that wrote the file) is left behind because it is never looked at, not because something
 *   remembered to remove it.
 * - Location is a separate switch. With it off no GPS data is written at all, not even the empty
 *   GPS block.
 * - The picture changed, so the data about the picture is rewritten, not copied: orientation is
 *   "upright" (the pixels already are), the size is the exported size, and the colour space is
 *   sRGB (the editor works in sRGB).
 * - The file is untrusted: every read is bounds-checked, sizes and counts are capped, and anything
 *   unreadable gives "no photo info", never an exception or a half-written file.
 *
 * Pure apart from the two small Blob helpers at the end. JPEG only, for now.
 */
import {
  buildExifSegment,
  findExifPayload,
  readJpegLayout,
  withExifSegment,
  MAX_SEGMENT_PAYLOAD,
} from "./jpegSegments";

type Entry = {
  tag: number;
  type: number;
  count: number;
  /** The value's bytes exactly as the source stored them, in the source's byte order. */
  value: Uint8Array;
};

export type PhotoInfo = {
  /** Byte order of the source, which the copied values are still in. */
  little: boolean;
  ifd0: Entry[];
  exif: Entry[];
  gps: Entry[];
};

// --- What may be copied -----------------------------------------------------------------------

const TAG = {
  Make: 0x010f,
  Model: 0x0110,
  Orientation: 0x0112,
  XResolution: 0x011a,
  YResolution: 0x011b,
  ResolutionUnit: 0x0128,
  YCbCrPositioning: 0x0213,
  Artist: 0x013b,
  Copyright: 0x8298,
  ExifIfd: 0x8769,
  GpsIfd: 0x8825,
  ExposureTime: 0x829a,
  FNumber: 0x829d,
  ExposureProgram: 0x8822,
  Iso: 0x8827,
  ExifVersion: 0x9000,
  DateTimeOriginal: 0x9003,
  DateTimeDigitized: 0x9004,
  OffsetTime: 0x9010,
  OffsetTimeOriginal: 0x9011,
  OffsetTimeDigitized: 0x9012,
  ComponentsConfiguration: 0x9101,
  ShutterSpeedValue: 0x9201,
  ApertureValue: 0x9202,
  ExposureBias: 0x9204,
  MaxApertureValue: 0x9205,
  MeteringMode: 0x9207,
  LightSource: 0x9208,
  Flash: 0x9209,
  FocalLength: 0x920a,
  SubSecTime: 0x9290,
  SubSecTimeOriginal: 0x9291,
  SubSecTimeDigitized: 0x9292,
  FlashpixVersion: 0xa000,
  ColorSpace: 0xa001,
  PixelXDimension: 0xa002,
  PixelYDimension: 0xa003,
  ExposureMode: 0xa402,
  WhiteBalance: 0xa403,
  DigitalZoomRatio: 0xa404,
  FocalLengthIn35mm: 0xa405,
  SceneCaptureType: 0xa406,
  LensSpecification: 0xa432,
  LensMake: 0xa433,
  LensModel: 0xa434,
} as const;

/** Copied as they are. Orientation, size and colour space are written fresh, never copied. */
const IFD0_COPY = new Set<number>([TAG.Make, TAG.Model, TAG.Artist, TAG.Copyright]);
const EXIF_COPY = new Set<number>([
  TAG.ExposureTime,
  TAG.FNumber,
  TAG.ExposureProgram,
  TAG.Iso,
  TAG.ExifVersion,
  TAG.DateTimeOriginal,
  TAG.DateTimeDigitized,
  TAG.OffsetTime,
  TAG.OffsetTimeOriginal,
  TAG.OffsetTimeDigitized,
  TAG.ComponentsConfiguration,
  TAG.ShutterSpeedValue,
  TAG.ApertureValue,
  TAG.ExposureBias,
  TAG.MaxApertureValue,
  TAG.MeteringMode,
  TAG.LightSource,
  TAG.Flash,
  TAG.FocalLength,
  TAG.SubSecTime,
  TAG.SubSecTimeOriginal,
  TAG.SubSecTimeDigitized,
  TAG.ExposureMode,
  TAG.WhiteBalance,
  TAG.DigitalZoomRatio,
  TAG.FocalLengthIn35mm,
  TAG.SceneCaptureType,
  TAG.LensSpecification,
  TAG.LensMake,
  TAG.LensModel,
]);
/** Where the photo was taken: version, latitude, longitude, altitude, time, and direction. */
const GPS_COPY = new Set<number>([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x10, 0x11, 0x1d,
]);
const GPS_LATITUDE = 0x02;
const GPS_LONGITUDE = 0x04;

// --- Limits: the file is untrusted -------------------------------------------------------------

const MAX_ENTRIES_PER_IFD = 512;
const MAX_VALUE_BYTES = 4096; // generous for any allowed tag; skips maker-note-sized values
export const MAX_READ_BYTES = 1_048_576; // metadata sits at the start; no need to read a whole photo

const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const UNDEFINED = 7;

// --- Reading ----------------------------------------------------------------------------------

/** The allowed entries of the TIFF structure in `tiff`, or null if there are none or it's damaged. */
export function parsePhotoInfo(tiff: Uint8Array): PhotoInfo | null {
  if (tiff.length < 8) return null;
  const order = String.fromCharCode(tiff[0]!, tiff[1]!);
  if (order !== "II" && order !== "MM") return null;
  const little = order === "II";
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 42) return null;

  const readIfd = (offset: number, allowed: ReadonlySet<number>, pointers: number[] = []) => {
    const entries: Entry[] = [];
    if (offset < 8 || offset + 2 > tiff.length) return entries;
    const count = Math.min(view.getUint16(offset, little), MAX_ENTRIES_PER_IFD);
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12;
      if (at + 12 > tiff.length) break;
      const tag = view.getUint16(at, little);
      const type = view.getUint16(at + 2, little);
      const n = view.getUint32(at + 4, little);
      const unit = TYPE_SIZE[type];
      const isPointer = pointers.includes(tag);
      if (!unit || (!allowed.has(tag) && !isPointer)) continue;
      const size = unit * n;
      if (!Number.isSafeInteger(size) || size > MAX_VALUE_BYTES) continue;
      let start = at + 8;
      if (size > 4) {
        start = view.getUint32(at + 8, little);
        if (start < 8 || start + size > tiff.length) continue;
      }
      entries.push({ tag, type, count: n, value: tiff.slice(start, start + size) });
    }
    return entries;
  };

  const ifd0Offset = view.getUint32(4, little);
  const top = readIfd(ifd0Offset, IFD0_COPY, [TAG.ExifIfd, TAG.GpsIfd]);
  const pointer = (tag: number) => {
    const e = top.find((x) => x.tag === tag);
    if (!e || e.type !== LONG || e.count !== 1) return 0;
    return new DataView(e.value.buffer, e.value.byteOffset, 4).getUint32(0, little);
  };
  const info: PhotoInfo = {
    little,
    ifd0: top.filter((e) => IFD0_COPY.has(e.tag)),
    exif: pointer(TAG.ExifIfd) ? readIfd(pointer(TAG.ExifIfd), EXIF_COPY) : [],
    gps: pointer(TAG.GpsIfd) ? readIfd(pointer(TAG.GpsIfd), GPS_COPY) : [],
  };
  return info.ifd0.length + info.exif.length + info.gps.length > 0 ? info : null;
}

/** Photo info from a whole JPEG's bytes, or null (not a JPEG, no EXIF, or nothing usable). */
export function readPhotoInfoFromBytes(bytes: Uint8Array): PhotoInfo | null {
  try {
    const layout = readJpegLayout(bytes);
    if (!layout) return null;
    const tiff = findExifPayload(bytes, layout);
    return tiff ? parsePhotoInfo(tiff) : null;
  } catch {
    return null;
  }
}

/** True when the source recorded where the photo was taken (both latitude and longitude). */
export function hasLocation(info: PhotoInfo): boolean {
  return (
    info.gps.some((e) => e.tag === GPS_LATITUDE) && info.gps.some((e) => e.tag === GPS_LONGITUDE)
  );
}

/** A short plain-language list of what is there, for the panel: "camera, exposure, date". */
export function describePhotoInfo(info: PhotoInfo): string {
  const has = (list: Entry[], ...tags: number[]) => list.some((e) => tags.includes(e.tag));
  const parts: string[] = [];
  if (has(info.ifd0, TAG.Make, TAG.Model) || has(info.exif, TAG.LensModel, TAG.LensMake)) {
    parts.push("camera");
  }
  if (
    has(
      info.exif,
      TAG.ExposureTime,
      TAG.FNumber,
      TAG.Iso,
      TAG.FocalLength,
      TAG.ExposureBias,
      TAG.Flash,
    )
  ) {
    parts.push("exposure");
  }
  if (has(info.exif, TAG.DateTimeOriginal, TAG.DateTimeDigitized)) parts.push("date");
  if (has(info.ifd0, TAG.Artist, TAG.Copyright)) parts.push("artist and copyright");
  return parts.length > 0 ? parts.join(", ") : "technical details";
}

// --- Writing ----------------------------------------------------------------------------------

export type PhotoInfoOptions = {
  /** The size of the exported picture. */
  width: number;
  height: number;
  /** Off unless the person turned it on. */
  includeLocation: boolean;
};

class Writer {
  private bytes: number[] = [];
  constructor(private readonly little: boolean) {}
  get length() {
    return this.bytes.length;
  }
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  u16(v: number) {
    if (this.little) this.bytes.push(v & 0xff, (v >> 8) & 0xff);
    else this.bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  u32(v: number) {
    if (this.little)
      this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    else this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  raw(v: ArrayLike<number>) {
    for (let i = 0; i < v.length; i++) this.bytes.push(v[i]! & 0xff);
  }
  done() {
    return Uint8Array.from(this.bytes);
  }
}

function entry(tag: number, type: number, count: number, value: Uint8Array): Entry {
  return { tag, type, count, value };
}

/** Builds a value in the output's byte order. */
function ownValue(little: boolean, type: number, numbers: number[]): Entry["value"] {
  const w = new Writer(little);
  for (const n of numbers) {
    if (type === SHORT) w.u16(n);
    else w.u32(n);
  }
  return w.done();
}

/** Lays out IFD0, the EXIF block and (if any) the GPS block as one TIFF structure. */
function buildTiff(little: boolean, ifd0: Entry[], exif: Entry[], gps: Entry[]): Uint8Array {
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  // Pointers are fixed-size, so every block's size is known before any offset is.
  const top = [...ifd0];
  const nTop = top.length + 1 + (gps.length > 0 ? 1 : 0); // plus the pointers added below
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(nTop);
  const gpsAt = exifAt + ifdSize(exif.length);
  const dataAt = gpsAt + (gps.length > 0 ? ifdSize(gps.length) : 0);

  const placed: { entries: Entry[]; at: number }[] = [];
  const pointerValue = (offset: number) => ownValue(little, LONG, [offset]);
  top.push(entry(TAG.ExifIfd, LONG, 1, pointerValue(exifAt)));
  if (gps.length > 0) top.push(entry(TAG.GpsIfd, LONG, 1, pointerValue(gpsAt)));
  placed.push({ entries: top, at: ifd0At }, { entries: exif, at: exifAt });
  if (gps.length > 0) placed.push({ entries: gps, at: gpsAt });

  const w = new Writer(little);
  w.raw([little ? 0x49 : 0x4d, little ? 0x49 : 0x4d]);
  w.u16(42);
  w.u32(ifd0At);

  const data = new Writer(little);
  let dataCursor = dataAt;
  for (const { entries } of placed) {
    const sorted = [...entries].sort((a, b) => a.tag - b.tag);
    w.u16(sorted.length);
    for (const e of sorted) {
      w.u16(e.tag);
      w.u16(e.type);
      w.u32(e.count);
      if (e.value.length <= 4) {
        w.raw(e.value);
        for (let i = e.value.length; i < 4; i++) w.u8(0);
      } else {
        w.u32(dataCursor);
        data.raw(e.value);
        dataCursor += e.value.length;
        if (e.value.length % 2 === 1) {
          data.u8(0); // values start on even offsets
          dataCursor += 1;
        }
      }
    }
    w.u32(0); // no next block: no thumbnail
  }
  const head = w.done();
  const tail = data.done();
  const out = new Uint8Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return out;
}

/**
 * The EXIF segment for an exported picture, or null when there is nothing to write or it would
 * not fit in one segment (then the file is simply saved without photo info).
 */
export function buildPhotoInfoSegment(
  info: PhotoInfo,
  options: PhotoInfoOptions,
): Uint8Array | null {
  const { little } = info;
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));

  const ifd0 = [
    ...info.ifd0.filter((e) => IFD0_COPY.has(e.tag)),
    // The pixels are already upright, so a copied tag would turn the photo a second time.
    entry(TAG.Orientation, SHORT, 1, ownValue(little, SHORT, [1])),
    // The standard requires these in a JPEG. They say nothing about the photo: 72 dpi, centred.
    entry(TAG.XResolution, RATIONAL, 1, ownValue(little, LONG, [72, 1])),
    entry(TAG.YResolution, RATIONAL, 1, ownValue(little, LONG, [72, 1])),
    entry(TAG.ResolutionUnit, SHORT, 1, ownValue(little, SHORT, [2])),
    entry(TAG.YCbCrPositioning, SHORT, 1, ownValue(little, SHORT, [1])),
  ];
  const exifCopied = info.exif.filter((e) => EXIF_COPY.has(e.tag));
  const exif = [
    ...exifCopied,
    entry(TAG.ColorSpace, SHORT, 1, ownValue(little, SHORT, [1])), // sRGB, what the editor makes
    entry(TAG.FlashpixVersion, UNDEFINED, 4, Uint8Array.of(0x30, 0x31, 0x30, 0x30)), // "0100"
    entry(TAG.PixelXDimension, LONG, 1, ownValue(little, LONG, [width])),
    entry(TAG.PixelYDimension, LONG, 1, ownValue(little, LONG, [height])),
  ];
  // Required by the standard, so present even if the source left them out.
  if (!exif.some((e) => e.tag === TAG.ExifVersion)) {
    exif.push(entry(TAG.ExifVersion, UNDEFINED, 4, Uint8Array.of(0x30, 0x32, 0x33, 0x30))); // "0230"
  }
  if (!exif.some((e) => e.tag === TAG.ComponentsConfiguration)) {
    exif.push(entry(TAG.ComponentsConfiguration, UNDEFINED, 4, Uint8Array.of(1, 2, 3, 0)));
  }
  const gps = options.includeLocation ? info.gps.filter((e) => GPS_COPY.has(e.tag)) : [];

  // The same tag twice is invalid; keep the first.
  const unique = (list: Entry[]) =>
    list.filter((e, i) => list.findIndex((x) => x.tag === e.tag) === i);
  const tiff = buildTiff(little, unique(ifd0), unique(exif), unique(gps));
  if (tiff.length + 6 > MAX_SEGMENT_PAYLOAD) return null;
  return buildExifSegment(tiff);
}

/** The JPEG with photo info added, or the JPEG as it was if that isn't possible. Never throws. */
export function addPhotoInfoToJpeg(
  jpeg: Uint8Array,
  info: PhotoInfo,
  options: PhotoInfoOptions,
): Uint8Array {
  try {
    const segment = buildPhotoInfoSegment(info, options);
    return segment ? withExifSegment(jpeg, segment) : jpeg;
  } catch {
    return jpeg;
  }
}

// --- Blobs (the only part that touches the browser's types) -----------------------------------

const JPEG_TYPES = ["image/jpeg", "image/jpg"];

/** Reads photo info from the original file. Only the start of the file is read. */
export async function readPhotoInfo(file: Blob): Promise<PhotoInfo | null> {
  if (!JPEG_TYPES.includes(file.type)) return null;
  try {
    return readPhotoInfoFromBytes(
      new Uint8Array(await file.slice(0, MAX_READ_BYTES).arrayBuffer()),
    );
  } catch {
    return null;
  }
}

/** The exported JPEG with photo info added; the same blob back if that fails. */
export async function withPhotoInfo(
  jpeg: Blob,
  info: PhotoInfo,
  options: PhotoInfoOptions,
): Promise<Blob> {
  try {
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    const out = addPhotoInfoToJpeg(bytes, info, options);
    return out === bytes ? jpeg : new Blob([out as BlobPart], { type: "image/jpeg" });
  } catch {
    return jpeg;
  }
}

// --- What the Export panel offers -------------------------------------------------------------

export type PhotoInfoChoice =
  | { kind: "unavailable"; reason: string }
  | { kind: "available"; summary: string; hasLocation: boolean };

/**
 * Whether "keep photo info" can be offered for this export, and if not, why, in words for the
 * panel. `info` is undefined while the original file is still being read.
 */
export function photoInfoChoice(
  format: string,
  info: PhotoInfo | null | undefined,
): PhotoInfoChoice {
  if (format !== "image/jpeg") {
    return { kind: "unavailable", reason: "Photo info can be kept when saving as JPG." };
  }
  if (info === undefined) return { kind: "unavailable", reason: "Reading the photo…" };
  if (info === null) {
    return { kind: "unavailable", reason: "This photo has no camera information to keep." };
  }
  return { kind: "available", summary: describePhotoInfo(info), hasLocation: hasLocation(info) };
}

/**
 * The options for writing the photo info, or null when it should not be written at all. Location
 * is written only when the person kept the info AND chose location AND the photo has any.
 */
export function photoInfoExportOptions(
  keepInfo: boolean,
  keepLocation: boolean,
  info: PhotoInfo | null | undefined,
  size: { width: number; height: number },
): PhotoInfoOptions | null {
  if (!keepInfo || !info) return null;
  return { ...size, includeLocation: keepLocation && hasLocation(info) };
}
