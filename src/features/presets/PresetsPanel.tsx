import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";
import {
  listPresets,
  savePreset,
  savePresets,
  deletePreset,
  type StoredPreset,
} from "@/engine/storage/presets";
import {
  MAX_PRESET_FILE_BYTES,
  describeImport,
  describeParseFailure,
  parsePresetFile,
  planImport,
  presetFileName,
  serializePresets,
} from "@/engine/storage/presetFile";
import { BUILTIN_PRESETS } from "./builtinPresets";
import { DEFAULT_ADJUSTMENTS } from "@/types/editor";
import { copyLook, describeLook, isPlainLook, sameLook } from "@/engine/image/editClipboard";

export function PresetsPanel() {
  const { state, isEdited, applyEdit, copiedLook, copyEdits, pasteEdits } = useEditor();
  const [userPresets, setUserPresets] = useState<StoredPreset[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listPresets().then(setUserPresets);
  }, []);

  const apply = (adjustments: Record<string, number | undefined>) => {
    applyEdit({ adjustments: { ...DEFAULT_ADJUSTMENTS, ...adjustments } });
  };

  const saveCurrent = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const preset: StoredPreset = {
      id: crypto.randomUUID(),
      name: trimmed,
      adjustments: { ...state.edit.adjustments },
    };
    await savePreset(preset);
    setUserPresets((prev) => [...prev, preset]);
    setName("");
    setNaming(false);
  };

  const exportPresets = () => {
    const blob = new Blob([serializePresets(userPresets)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = presetFileName();
    a.click();
    URL.revokeObjectURL(url);
    const n = userPresets.length;
    setFileNote(`Saved ${n} ${n === 1 ? "preset" : "presets"} to ${a.download}.`);
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_PRESET_FILE_BYTES) {
      setFileNote(describeParseFailure("too-big"));
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileNote("Pictoe couldn't read that file.");
      return;
    }
    const parsed = parsePresetFile(text);
    if (!parsed.ok) {
      setFileNote(describeParseFailure(parsed.reason));
      return;
    }
    // Compare against what is saved right now, not what this panel last saw.
    const plan = planImport(await listPresets(), parsed.presets);
    if (!(await savePresets(plan.toAdd))) {
      setFileNote("Pictoe couldn't save these presets in this browser.");
      return;
    }
    setUserPresets(await listPresets());
    setFileNote(describeImport(plan, parsed.skipped, parsed.fromNewerVersion));
  };

  const remove = async (id: string) => {
    await deletePreset(id);
    setUserPresets((prev) => prev.filter((p) => p.id !== id));
  };

  const canCopy = !isPlainLook(copyLook(state.edit));
  // Pasting what this photo already has would change nothing, so it is not offered.
  const canPaste = copiedLook !== null && !sameLook(copyLook(state.edit), copiedLook);

  return (
    <div className="flex flex-col gap-md">
      <div>
        <p className="mb-xs text-[11px] uppercase tracking-[0.12em] text-text-muted">Copy edits</p>
        <div className="flex gap-xs">
          <button
            type="button"
            onClick={copyEdits}
            disabled={!canCopy}
            className="flex-1 rounded-md border border-border px-sm py-1.5 text-[12px] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-secondary"
          >
            Copy edits
          </button>
          <button
            type="button"
            onClick={pasteEdits}
            disabled={!canPaste}
            className="flex-1 rounded-md border border-border px-sm py-1.5 text-[12px] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-secondary"
          >
            Paste edits
          </button>
        </div>
        <p role="status" className="mt-xs text-[12px] text-text-muted">
          {copiedLook
            ? `Copied: ${describeLook(copiedLook)}. Crop, healing and local areas stay with each photo.`
            : "Copy this photo's look to paste it onto another."}
        </p>
      </div>

      <div>
        <p className="mb-xs text-[11px] uppercase tracking-[0.12em] text-text-muted">Built-in</p>
        <div className="flex flex-wrap gap-xs">
          {BUILTIN_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => apply(p.adjustments)}
              className="rounded-full border border-border px-md py-1 text-[12px] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-accent"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-xs text-[11px] uppercase tracking-[0.12em] text-text-muted">Yours</p>
        {userPresets.length === 0 && (
          <p className="text-[12px] text-text-muted">No saved presets yet.</p>
        )}
        <div className="flex flex-wrap gap-xs">
          {userPresets.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-xs rounded-full border border-border py-1 pl-md pr-xs text-[12px] text-text-secondary"
            >
              <button
                type="button"
                onClick={() => apply(p.adjustments)}
                className="transition-colors duration-150 hover:text-accent"
              >
                {p.name}
              </button>
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Delete preset ${p.name}`}
                className="text-text-muted transition-colors duration-150 hover:text-danger"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div>
        {naming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveCurrent();
            }}
            className="flex items-center gap-xs"
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Preset name"
              className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-sm py-1 text-[12px] text-text-primary placeholder:text-text-muted focus:border-accent/60 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-accent px-sm py-1 text-[12px] font-medium text-accent-foreground transition-colors duration-150 hover:bg-accent-strong"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setNaming(false);
                setName("");
              }}
              className="text-[12px] text-text-muted transition-colors duration-150 hover:text-text-secondary"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            disabled={!isEdited}
            className="text-[12px] text-accent transition-colors duration-150 hover:text-accent-strong disabled:cursor-not-allowed disabled:text-text-muted"
          >
            Save current as preset
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center gap-md">
          <button
            type="button"
            onClick={exportPresets}
            disabled={userPresets.length === 0}
            className="text-[12px] text-text-secondary transition-colors duration-150 hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-muted"
          >
            Export presets
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="text-[12px] text-text-secondary transition-colors duration-150 hover:text-text-primary"
          >
            Import presets
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label="Import presets file"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // so choosing the same file again still counts
              if (file) void importFile(file);
            }}
          />
        </div>
        {fileNote && (
          <p role="status" className="mt-xs text-[12px] text-text-muted">
            {fileNote}
          </p>
        )}
      </div>
    </div>
  );
}
