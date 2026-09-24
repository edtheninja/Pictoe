import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useEditor } from "@/state/editor/EditorContext";
import { listPresets, savePreset, deletePreset, type StoredPreset } from "@/engine/storage/presets";
import { BUILTIN_PRESETS } from "./builtinPresets";
import { DEFAULT_ADJUSTMENTS } from "@/types/editor";

export function PresetsPanel() {
    const { state, isEdited, applyEdit } = useEditor();
    const [userPresets, setUserPresets] = useState<StoredPreset[]>([]);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState("");

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

    const remove = async (id: string) => {
        await deletePreset(id);
        setUserPresets((prev) => prev.filter((p) => p.id !== id));
    };

    return (
        <div className="flex flex-col gap-md">
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
        </div>
    );
}
