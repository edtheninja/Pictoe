/**
 * Pure state transitions for the editor: the edit state, undo/redo history, jumpTo and local
 * areas. No React and no DOM, so it can be tested directly. EditorContext wires it into React.
 */
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CROP,
  DEFAULT_EDIT_STATE,
  DEFAULT_LOCAL_ADJUSTMENTS,
  identityCurves,
  type AdjustmentKey,
  type EditState,
  type HealStroke,
  type ImageAnalysis,
  type LocalAdjustments,
  type MaskLayer,
  type MaskShape,
  type MaskStroke,
  type ProcessingState,
  type SourceImage,
  type ToolId,
  type Viewport,
} from "@/types/editor";
import { sanitizeShape } from "@/engine/image/maskShapes";

type State = {
  source: SourceImage | null;
  edit: EditState;
  past: EditState[];
  future: EditState[];
  viewport: Viewport;
  activeTool: ToolId | null;
  processing: ProcessingState;
  error: string | null;
  showOriginal: boolean;
  analysis: ImageAnalysis | null;
  maskLayers: MaskLayer[];
  activeMaskLayerId: string | null;
  maskMode: "paint" | "erase";
  maskPast: MaskSnapshot[];
  maskFuture: MaskSnapshot[];
  maskBrushSize: number;
  maskBrushSoftness: number;
  healBrushSize: number;
  healBrushSoftness: number;
  /** Where the clone tool copies from, as 0–1 across the source image. Null until chosen. */
  healSource: { x: number; y: number } | null;
  /** Fixed once painting starts so later strokes keep the same relationship to the source. */
  healOffset: { dx: number; dy: number } | null;
};

type MaskSnapshot = {
  maskLayers: MaskLayer[];
  activeMaskLayerId: string | null;
};

const initialState: State = {
  source: null,
  edit: DEFAULT_EDIT_STATE,
  past: [],
  future: [],
  viewport: { zoom: 1, panX: 0, panY: 0 },
  activeTool: "adjust",
  processing: "idle",
  error: null,
  showOriginal: false,
  analysis: null,
  maskLayers: [],
  activeMaskLayerId: null,
  maskMode: "paint",
  maskPast: [],
  maskFuture: [],
  maskBrushSize: 60,
  maskBrushSoftness: 30,
  healBrushSize: 40,
  healBrushSoftness: 30,
  healSource: null,
  healOffset: null,
};

type Action =
  | { type: "setSource"; source: SourceImage; analysis: ImageAnalysis }
  | {
      type: "restoreSession";
      source: SourceImage;
      analysis: ImageAnalysis;
      edit: EditState;
      maskLayers?: MaskLayer[];
    }
  | { type: "closeImage" }
  | { type: "setAdjustment"; key: AdjustmentKey; value: number }
  | { type: "commit"; snapshot: EditState }
  | { type: "applyEdit"; edit: Partial<EditState>; commit?: boolean }
  | { type: "resetAdjustment"; key: AdjustmentKey }
  | { type: "resetAll" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "jumpTo"; index: number }
  | { type: "setViewport"; viewport: Partial<Viewport> }
  | { type: "setTool"; tool: ToolId | null }
  | { type: "setProcessing"; processing: ProcessingState }
  | { type: "setError"; error: string | null }
  | { type: "setShowOriginal"; value: boolean }
  | { type: "addMaskLayer"; shape?: MaskShape }
  | { type: "duplicateMaskLayer"; id: string }
  | { type: "renameMaskLayer"; id: string; name: string }
  | { type: "setMaskLayerInverted"; id: string; inverted: boolean }
  | { type: "setMaskLayerVisible"; id: string; visible: boolean }
  | { type: "moveMaskLayer"; id: string; toIndex: number }
  | { type: "setMaskShape"; id: string; shape: MaskShape }
  | { type: "deleteMaskLayer"; id: string }
  | { type: "setActiveMaskLayer"; id: string | null }
  | { type: "setMaskMode"; mode: "paint" | "erase" }
  | { type: "paintMaskStroke"; id: string; stroke: MaskStroke }
  | { type: "setMaskLayerAdjustment"; id: string; key: keyof LocalAdjustments; value: number }
  | { type: "recordMaskHistory" }
  | { type: "undoMask" }
  | { type: "redoMask" }
  | { type: "setMaskBrushSize"; value: number }
  | { type: "setMaskBrushSoftness"; value: number }
  | { type: "addHealStroke"; stroke: HealStroke }
  | { type: "setHealBrushSize"; value: number }
  | { type: "setHealBrushSoftness"; value: number }
  | { type: "setHealSource"; source: { x: number; y: number } | null }
  | { type: "setHealOffset"; offset: { dx: number; dy: number } | null };

const HISTORY_LIMIT = 60;
const MAX_MASK_NAME_LENGTH = 60;

function pushHistory(state: State, snapshot: EditState): Pick<State, "past" | "future"> {
  const past = [...state.past, snapshot].slice(-HISTORY_LIMIT);
  return { past, future: [] };
}

function pushMaskHistory(state: State): Pick<State, "maskPast" | "maskFuture"> {
  const snapshot: MaskSnapshot = {
    maskLayers: state.maskLayers,
    activeMaskLayerId: state.activeMaskLayerId,
  };

  return {
    maskPast: [...state.maskPast, snapshot].slice(-HISTORY_LIMIT),
    maskFuture: [],
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "setSource":
      return {
        ...initialState,
        source: action.source,
        analysis: action.analysis,
        activeTool: "adjust",
      };
    case "restoreSession":
      return {
        ...initialState,
        source: action.source,
        analysis: action.analysis,
        edit: action.edit,
        maskLayers: action.maskLayers ?? [],
        activeMaskLayerId: action.maskLayers?.[0]?.id ?? null,
        activeTool: "adjust",
      };
    case "closeImage":
      return { ...initialState };
    case "setAdjustment":
      return {
        ...state,
        edit: {
          ...state.edit,
          adjustments: { ...state.edit.adjustments, [action.key]: action.value },
        },
      };
    case "commit":
      // Only record if something actually changed.
      if (JSON.stringify(action.snapshot) === JSON.stringify(state.edit)) return state;
      return { ...state, ...pushHistory(state, action.snapshot) };
    case "applyEdit": {
      const next = { ...state.edit, ...action.edit };
      if (action.commit === false) return { ...state, edit: next };
      return { ...state, edit: next, ...pushHistory(state, state.edit) };
    }
    case "resetAdjustment":
      return {
        ...state,
        edit: {
          ...state.edit,
          adjustments: {
            ...state.edit.adjustments,
            [action.key]: DEFAULT_ADJUSTMENTS[action.key],
          },
        },
        ...pushHistory(state, state.edit),
      };
    case "resetAll":
      return {
        ...state,
        edit: {
          adjustments: { ...DEFAULT_ADJUSTMENTS },
          crop: { ...DEFAULT_CROP },
          rotation: 0,
          flipH: false,
          healStrokes: [],
          curves: identityCurves(),
        },
        ...pushHistory(state, state.edit),
      };
    case "undo": {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1]!;
      return {
        ...state,
        edit: previous,
        past: state.past.slice(0, -1),
        future: [state.edit, ...state.future].slice(0, HISTORY_LIMIT),
      };
    }
    case "redo": {
      if (!state.future.length) return state;
      const next = state.future[0]!;
      return {
        ...state,
        edit: next,
        past: [...state.past, state.edit].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
      };
    }
    case "jumpTo": {
      const timeline = [...state.past, state.edit, ...state.future];
      const clamped = Math.max(0, Math.min(action.index, timeline.length - 1));
      if (clamped === state.past.length) return state;
      return {
        ...state,
        edit: timeline[clamped]!,
        past: timeline.slice(0, clamped),
        future: timeline.slice(clamped + 1),
      };
    }
    case "setViewport":
      return { ...state, viewport: { ...state.viewport, ...action.viewport } };
    case "setTool":
      return { ...state, activeTool: state.activeTool === action.tool ? null : action.tool };
    case "setProcessing":
      return { ...state, processing: action.processing };
    case "setError":
      return { ...state, error: action.error };
    case "setShowOriginal":
      return { ...state, showOriginal: action.value };
    case "recordMaskHistory":
      return { ...state, ...pushMaskHistory(state) };

    case "setMaskBrushSize":
      return { ...state, maskBrushSize: action.value };

    case "setMaskBrushSoftness":
      return { ...state, maskBrushSoftness: action.value };
    // Live, like painting a mask stroke: no history entry per dab. The overlay brackets a whole
    // drag with beginInteraction/endInteraction so it becomes one undo step.
    case "addHealStroke":
      return {
        ...state,
        edit: { ...state.edit, healStrokes: [...state.edit.healStrokes, action.stroke] },
      };
    case "setHealBrushSize":
      return { ...state, healBrushSize: action.value };
    case "setHealBrushSoftness":
      return { ...state, healBrushSoftness: action.value };
    // Choosing a new source starts over, so the old offset no longer applies.
    case "setHealSource":
      return { ...state, healSource: action.source, healOffset: null };
    case "setHealOffset":
      return { ...state, healOffset: action.offset };

    case "undoMask": {
      if (!state.maskPast.length) return state;

      const previous = state.maskPast[state.maskPast.length - 1]!;

      return {
        ...state,
        maskLayers: previous.maskLayers,
        activeMaskLayerId: previous.activeMaskLayerId,
        maskPast: state.maskPast.slice(0, -1),
        maskFuture: [
          {
            maskLayers: state.maskLayers,
            activeMaskLayerId: state.activeMaskLayerId,
          },
          ...state.maskFuture,
        ].slice(0, HISTORY_LIMIT),
      };
    }

    case "redoMask": {
      if (!state.maskFuture.length) return state;

      const next = state.maskFuture[0]!;

      return {
        ...state,
        maskLayers: next.maskLayers,
        activeMaskLayerId: next.activeMaskLayerId,
        maskPast: [
          ...state.maskPast,
          {
            maskLayers: state.maskLayers,
            activeMaskLayerId: state.activeMaskLayerId,
          },
        ].slice(-HISTORY_LIMIT),
        maskFuture: state.maskFuture.slice(1),
      };
    }
    case "addMaskLayer": {
      const id = crypto.randomUUID();
      // An unusable shape (not a number, two coincident points) is refused rather than turned
      // into a brush layer the caller did not ask for.
      const shape = action.shape ? sanitizeShape(action.shape) : undefined;
      if (action.shape && !shape) return state;
      const label = !shape ? "Area" : shape.kind === "linear" ? "Gradient" : "Radial";
      const name = `${label} ${state.maskLayers.length + 1}`;

      return {
        ...state,
        ...pushMaskHistory(state),
        maskLayers: [
          ...state.maskLayers,
          {
            id,
            name,
            strokes: [],
            adjustments: { ...DEFAULT_LOCAL_ADJUSTMENTS },
            ...(shape ? { shape } : {}),
          },
        ],
        activeMaskLayerId: id,
      };
    }

    // The copy goes straight after the original (so it renders on top of it) and becomes the
    // active layer. Strokes are immutable, so the copy can share them.
    case "duplicateMaskLayer": {
      const index = state.maskLayers.findIndex((l) => l.id === action.id);
      if (index === -1) return state;
      const original = state.maskLayers[index]!;
      const copy: MaskLayer = {
        ...original,
        id: crypto.randomUUID(),
        name: `${original.name} copy`.slice(0, MAX_MASK_NAME_LENGTH),
        strokes: [...original.strokes],
        adjustments: { ...original.adjustments },
        ...(original.shape ? { shape: { ...original.shape } } : {}),
      };

      return {
        ...state,
        ...pushMaskHistory(state),
        maskLayers: [
          ...state.maskLayers.slice(0, index + 1),
          copy,
          ...state.maskLayers.slice(index + 1),
        ],
        activeMaskLayerId: copy.id,
      };
    }

    case "renameMaskLayer": {
      const name = action.name.trim().slice(0, MAX_MASK_NAME_LENGTH);
      const layer = state.maskLayers.find((l) => l.id === action.id);
      if (!layer || name === "" || name === layer.name) return state;
      return {
        ...state,
        ...pushMaskHistory(state),
        maskLayers: state.maskLayers.map((l) => (l.id === action.id ? { ...l, name } : l)),
      };
    }

    // `invert` and `visible` are only stored when they differ from the default, so setting
    // the default again removes the key instead of writing `false` / `true`.
    case "setMaskLayerInverted": {
      const layer = state.maskLayers.find((l) => l.id === action.id);
      if (!layer || (layer.invert === true) === action.inverted) return state;
      return {
        ...state,
        ...pushMaskHistory(state),
        maskLayers: state.maskLayers.map((l) => {
          if (l.id !== action.id) return l;
          const { invert: _drop, ...rest } = l;
          return action.inverted ? { ...rest, invert: true } : rest;
        }),
      };
    }

    case "setMaskLayerVisible": {
      const layer = state.maskLayers.find((l) => l.id === action.id);
      if (!layer || (layer.visible !== false) === action.visible) return state;
      return {
        ...state,
        ...pushMaskHistory(state),
        maskLayers: state.maskLayers.map((l) => {
          if (l.id !== action.id) return l;
          const { visible: _drop, ...rest } = l;
          return action.visible ? rest : { ...rest, visible: false };
        }),
      };
    }

    // Array order is render order: index 0 is rendered first, the last layer on top.
    case "moveMaskLayer": {
      const from = state.maskLayers.findIndex((l) => l.id === action.id);
      if (from === -1 || !Number.isFinite(action.toIndex)) return state;
      const to = Math.min(state.maskLayers.length - 1, Math.max(0, Math.trunc(action.toIndex)));
      if (to === from) return state;
      const layers = [...state.maskLayers];
      const [moved] = layers.splice(from, 1);
      layers.splice(to, 0, moved!);
      return { ...state, ...pushMaskHistory(state), maskLayers: layers };
    }

    // Live, like painting a stroke: no history entry per pointer move. The overlay brackets a
    // whole drag with recordMaskHistory. Only a gradient layer of the same kind can be reshaped.
    case "setMaskShape": {
      const layer = state.maskLayers.find((l) => l.id === action.id);
      const shape = sanitizeShape(action.shape);
      if (!layer?.shape || !shape || layer.shape.kind !== shape.kind) return state;
      return {
        ...state,
        maskLayers: state.maskLayers.map((l) => (l.id === action.id ? { ...l, shape } : l)),
      };
    }

    case "deleteMaskLayer": {
      if (!state.maskLayers.some((layer) => layer.id === action.id)) {
        return state;
      }

      return {
        ...state,
        ...pushMaskHistory(state),
        maskLayers: state.maskLayers.filter((layer) => layer.id !== action.id),
        activeMaskLayerId: state.activeMaskLayerId === action.id ? null : state.activeMaskLayerId,
      };
    }
    case "setActiveMaskLayer":
      return { ...state, activeMaskLayerId: action.id };
    case "setMaskMode":
      return { ...state, maskMode: action.mode };
    case "paintMaskStroke":
      return {
        ...state,
        // Gradient layers have no strokes; painting on one does nothing.
        maskLayers: state.maskLayers.map((l) =>
          l.id === action.id && !l.shape ? { ...l, strokes: [...l.strokes, action.stroke] } : l,
        ),
      };
    case "setMaskLayerAdjustment":
      return {
        ...state,
        maskLayers: state.maskLayers.map((l) =>
          l.id === action.id
            ? { ...l, adjustments: { ...l.adjustments, [action.key]: action.value } }
            : l,
        ),
      };
    default:
      return state;
  }
}

export { reducer as editorReducer, initialState as editorInitialState };
export type { State as EditorState, Action as EditorAction };
