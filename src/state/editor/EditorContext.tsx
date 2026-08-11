import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CROP,
  DEFAULT_EDIT_STATE,
  type AdjustmentKey,
  type CropRect,
  type EditState,
  type ProcessingState,
  type SourceImage,
  type ToolId,
  type Viewport,
} from "@/types/editor";

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
};

type Action =
  | { type: "setSource"; source: SourceImage }
  | { type: "closeImage" }
  | { type: "setAdjustment"; key: AdjustmentKey; value: number }
  | { type: "commit"; snapshot: EditState }
  | { type: "applyEdit"; edit: Partial<EditState>; commit?: boolean }
  | { type: "resetAdjustment"; key: AdjustmentKey }
  | { type: "resetAll" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setViewport"; viewport: Partial<Viewport> }
  | { type: "setTool"; tool: ToolId | null }
  | { type: "setProcessing"; processing: ProcessingState }
  | { type: "setError"; error: string | null }
  | { type: "setShowOriginal"; value: boolean };

const HISTORY_LIMIT = 60;

function pushHistory(state: State, snapshot: EditState): Pick<State, "past" | "future"> {
  const past = [...state.past, snapshot].slice(-HISTORY_LIMIT);
  return { past, future: [] };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "setSource":
      return {
        ...initialState,
        source: action.source,
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
    default:
      return state;
  }
}

type EditorApi = {
  state: State;
  canUndo: boolean;
  canRedo: boolean;
  isEdited: boolean;
  setSource: (s: SourceImage) => void;
  closeImage: () => void;
  /** live drag: updates value without touching history */
  setAdjustment: (key: AdjustmentKey, value: number) => void;
  /** call on drag start to capture the pre-change snapshot */
  beginInteraction: () => void;
  /** call on drag end to record the snapshot in history */
  endInteraction: () => void;
  resetAdjustment: (key: AdjustmentKey) => void;
  resetAll: () => void;
  applyEdit: (edit: Partial<EditState>) => void;
  applyAdjustments: (patch: Partial<Record<AdjustmentKey, number>>) => void;
  undo: () => void;
  redo: () => void;
  setViewport: (v: Partial<Viewport>) => void;
  setTool: (t: ToolId | null) => void;
  setProcessing: (p: ProcessingState) => void;
  setError: (e: string | null) => void;
  setShowOriginal: (v: boolean) => void;
};

const EditorContext = createContext<EditorApi | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const snapshotRef = useRef<EditState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const beginInteraction = useCallback(() => {
    snapshotRef.current = stateRef.current.edit;
  }, []);

  const endInteraction = useCallback(() => {
    if (snapshotRef.current) {
      dispatch({ type: "commit", snapshot: snapshotRef.current });
      snapshotRef.current = null;
    }
  }, []);

  const api = useMemo<EditorApi>(
    () => ({
      state,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      isEdited: JSON.stringify(state.edit) !== JSON.stringify(DEFAULT_EDIT_STATE),
      setSource: (source) => dispatch({ type: "setSource", source }),
      closeImage: () => dispatch({ type: "closeImage" }),
      setAdjustment: (key, value) => dispatch({ type: "setAdjustment", key, value }),
      beginInteraction,
      endInteraction,
      resetAdjustment: (key) => dispatch({ type: "resetAdjustment", key }),
      resetAll: () => dispatch({ type: "resetAll" }),
      applyEdit: (edit) => dispatch({ type: "applyEdit", edit }),
      applyAdjustments: (patch) =>
        dispatch({
          type: "applyEdit",
          edit: {
            adjustments: { ...stateRef.current.edit.adjustments, ...patch },
          },
        }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      setViewport: (viewport) => dispatch({ type: "setViewport", viewport }),
      setTool: (tool) => dispatch({ type: "setTool", tool }),
      setProcessing: (processing) => dispatch({ type: "setProcessing", processing }),
      setError: (error) => dispatch({ type: "setError", error }),
      setShowOriginal: (value) => dispatch({ type: "setShowOriginal", value }),
    }),
    [state, beginInteraction, endInteraction],
  );

  return <EditorContext.Provider value={api}>{children}</EditorContext.Provider>;
}

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside EditorProvider");
  return ctx;
}

export type { CropRect };
