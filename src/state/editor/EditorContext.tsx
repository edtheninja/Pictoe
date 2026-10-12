import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_EDIT_STATE,
  type AdjustmentKey,
  type CropRect,
  type EditState,
  type LocalAdjustments,
  type MaskStroke,
  type ProcessingState,
  type SourceImage,
  type ToolId,
  type Viewport,
} from "@/types/editor";
import { editorInitialState, editorReducer, type EditorState } from "./editorReducer";
import { analyzeImage } from "@/engine/image/analyze";
import { saveSession, loadSession, clearSession } from "@/engine/storage/session";
import { frameOf, migrateLegacyLayers } from "@/engine/image/maskSpace";

type EditorApi = {
  state: EditorState;
  canUndo: boolean;
  canRedo: boolean;
  isEdited: boolean;
  setSource: (source: SourceImage) => void;
  closeImage: () => void;
  /** live drag: updates value without touching history */
  setAdjustment: (key: AdjustmentKey, value: number) => void;
  /** call on drag start to capture the pre-change snapshot */
  beginInteraction: () => void;
  /** call on drag end to record the snapshot in history */
  endInteraction: () => void;
  /** call to abandon a beginInteraction() without recording history */
  cancelInteraction: () => void;
  resetAdjustment: (key: AdjustmentKey) => void;
  resetAll: () => void;
  applyEdit: (edit: Partial<EditState>) => void;
  applyAdjustments: (patch: Partial<Record<AdjustmentKey, number>>) => void;
  undo: () => void;
  redo: () => void;
  jumpToHistory: (index: number) => void;
  setViewport: (v: Partial<Viewport>) => void;
  setTool: (t: ToolId | null) => void;
  setProcessing: (p: ProcessingState) => void;
  setError: (e: string | null) => void;
  setShowOriginal: (v: boolean) => void;
  /** Local (masked) areas — outside undo/redo; deleting a layer is how you "undo" it. */
  addMaskLayer: () => void;
  deleteMaskLayer: (id: string) => void;
  setActiveMaskLayer: (id: string | null) => void;
  setMaskMode: (mode: "paint" | "erase") => void;
  paintMaskStroke: (id: string, stroke: MaskStroke) => void;
  setMaskLayerAdjustment: (id: string, key: keyof LocalAdjustments, value: number) => void;
  recordMaskHistory: () => void;
  setMaskBrushSize: (value: number) => void;
  setMaskBrushSoftness: (value: number) => void;
};

const EditorContext = createContext<EditorApi | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, editorInitialState);
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

  const cancelInteraction = useCallback(() => {
    if (snapshotRef.current) {
      dispatch({ type: "applyEdit", edit: snapshotRef.current, commit: false });
      snapshotRef.current = null;
    }
  }, []);

  // Restore a saved session once, on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadSession();
      if (!saved || cancelled) return;
      const url = URL.createObjectURL(saved.imageBlob);
      try {
        const element = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("restore failed"));
          img.src = url;
        });
        if (cancelled) return;
        const source: SourceImage = {
          element,
          width: element.naturalWidth,
          height: element.naturalHeight,
          name: saved.name,
          type: saved.type,
          blob: saved.imageBlob,
        };
        dispatch({
          type: "restoreSession",
          source,
          analysis: analyzeImage(element),
          edit: saved.edit,
          maskLayers:
            saved.maskSpace === "source"
              ? (saved.maskLayers ?? [])
              : migrateLegacyLayers(
                  saved.maskLayers ?? [],
                  frameOf(source.width, source.height, saved.edit),
                ),
        });
      } catch {
        // Corrupt/unreadable saved session — fall back to the empty state
        // rather than block the app.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Autosave, debounced — avoids writing to IndexedDB on every slider frame.
  const saveTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.source) return;

    if (saveTimeoutRef.current !== undefined) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      if (!state.source) return;

      void saveSession({
        imageBlob: state.source.blob,
        name: state.source.name,
        type: state.source.type,
        edit: state.edit,
        maskLayers: state.maskLayers,
        maskSpace: "source",
      });
    }, 800);

    return () => {
      if (saveTimeoutRef.current !== undefined) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [state.source, state.edit, state.maskLayers]);

  const api = useMemo<EditorApi>(
    () => ({
      state,
      canUndo: state.activeTool === "mask" ? state.maskPast.length > 0 : state.past.length > 0,
      canRedo: state.activeTool === "mask" ? state.maskFuture.length > 0 : state.future.length > 0,
      isEdited: JSON.stringify(state.edit) !== JSON.stringify(DEFAULT_EDIT_STATE),
      setSource: (source) =>
        dispatch({ type: "setSource", source, analysis: analyzeImage(source.element) }),
      closeImage: () => {
        dispatch({ type: "closeImage" });
        clearSession();
      },
      setAdjustment: (key, value) => dispatch({ type: "setAdjustment", key, value }),
      beginInteraction,
      endInteraction,
      cancelInteraction,
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
      undo: () =>
        dispatch({
          type: stateRef.current.activeTool === "mask" ? "undoMask" : "undo",
        }),

      redo: () =>
        dispatch({
          type: stateRef.current.activeTool === "mask" ? "redoMask" : "redo",
        }),
      jumpToHistory: (index) => dispatch({ type: "jumpTo", index }),
      setViewport: (viewport) => dispatch({ type: "setViewport", viewport }),
      setTool: (tool) => dispatch({ type: "setTool", tool }),
      setProcessing: (processing) => dispatch({ type: "setProcessing", processing }),
      setError: (error) => dispatch({ type: "setError", error }),
      setShowOriginal: (value) => dispatch({ type: "setShowOriginal", value }),
      addMaskLayer: () => dispatch({ type: "addMaskLayer" }),
      deleteMaskLayer: (id) => dispatch({ type: "deleteMaskLayer", id }),
      setActiveMaskLayer: (id) => dispatch({ type: "setActiveMaskLayer", id }),
      setMaskMode: (mode) => dispatch({ type: "setMaskMode", mode }),
      paintMaskStroke: (id, stroke) => dispatch({ type: "paintMaskStroke", id, stroke }),
      setMaskLayerAdjustment: (id, key, value) =>
        dispatch({ type: "setMaskLayerAdjustment", id, key, value }),
      recordMaskHistory: () => dispatch({ type: "recordMaskHistory" }),
      setMaskBrushSize: (value) => dispatch({ type: "setMaskBrushSize", value }),
      setMaskBrushSoftness: (value) => dispatch({ type: "setMaskBrushSoftness", value }),
    }),
    [state, beginInteraction, endInteraction, cancelInteraction],
  );

  return <EditorContext.Provider value={api}>{children}</EditorContext.Provider>;
}

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside EditorProvider");
  return ctx;
}

export type { CropRect };
