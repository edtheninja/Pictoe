export type Adjustments = {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;

  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;

  sharpness: number;
  clarity: number;
  blur: number;
};

export type AdjustmentKey = keyof Adjustments;

export type CropRect = { x: number; y: number; width: number; height: number };

/** The full, serializable, non-destructive description of an edit. */
export type EditState = {
  adjustments: Adjustments;
  crop: CropRect; // normalized 0..1 relative to the (rotated) source
  rotation: number; // degrees, multiples of 90
  flipH: boolean;
};

export type Viewport = { zoom: number; panX: number; panY: number };

export type ToolId = "adjust" | "color" | "detail" | "crop" | "heal" | "intent";

export type SourceImage = {
  element: HTMLImageElement;
  width: number;
  height: number;
  name: string;
  type: string;
};

export type ProcessingState = "idle" | "rendering" | "exporting" | "error";

export type ExportFormat = "image/jpeg" | "image/png" | "image/webp";
export type ExportQuality = "high" | "medium" | "custom";

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  sharpness: 0,
  clarity: 0,
  blur: 0,
};

export const DEFAULT_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export const DEFAULT_EDIT_STATE: EditState = {
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  crop: { ...DEFAULT_CROP },
  rotation: 0,
  flipH: false,
};

export type AdjustmentDef = {
  key: AdjustmentKey;
  label: string;
  min: number;
  max: number;
  step: number;
  group: "light" | "color" | "detail";
  /** Progressive disclosure level */
  level: "basic" | "advanced";
};

export const ADJUSTMENT_DEFS: AdjustmentDef[] = [
  {
    key: "exposure",
    label: "Exposure",
    min: -100,
    max: 100,
    step: 1,
    group: "light",
    level: "basic",
  },
  {
    key: "brightness",
    label: "Brightness",
    min: -100,
    max: 100,
    step: 1,
    group: "light",
    level: "basic",
  },
  {
    key: "contrast",
    label: "Contrast",
    min: -100,
    max: 100,
    step: 1,
    group: "light",
    level: "basic",
  },
  {
    key: "highlights",
    label: "Highlights",
    min: -100,
    max: 100,
    step: 1,
    group: "light",
    level: "advanced",
  },
  {
    key: "shadows",
    label: "Shadows",
    min: -100,
    max: 100,
    step: 1,
    group: "light",
    level: "advanced",
  },
  {
    key: "whites",
    label: "Whites",
    min: -100,
    max: 100,
    step: 1,
    group: "light",
    level: "advanced",
  },
  {
    key: "blacks",
    label: "Blacks",
    min: -100,
    max: 100,
    step: 1,
    group: "light",
    level: "advanced",
  },

  {
    key: "saturation",
    label: "Saturation",
    min: -100,
    max: 100,
    step: 1,
    group: "color",
    level: "basic",
  },
  {
    key: "vibrance",
    label: "Vibrance",
    min: -100,
    max: 100,
    step: 1,
    group: "color",
    level: "basic",
  },
  {
    key: "temperature",
    label: "Temperature",
    min: -100,
    max: 100,
    step: 1,
    group: "color",
    level: "basic",
  },
  { key: "tint", label: "Tint", min: -100, max: 100, step: 1, group: "color", level: "advanced" },

  {
    key: "sharpness",
    label: "Sharpness",
    min: 0,
    max: 100,
    step: 1,
    group: "detail",
    level: "basic",
  },
  {
    key: "clarity",
    label: "Clarity",
    min: -100,
    max: 100,
    step: 1,
    group: "detail",
    level: "basic",
  },
  { key: "blur", label: "Blur", min: 0, max: 100, step: 1, group: "detail", level: "advanced" },
];
