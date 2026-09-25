import { useState } from "react";
import { History as HistoryIcon, Check } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useEditor } from "@/state/editor/EditorContext";
import { ADJUSTMENT_DEFS, type EditState, type AdjustmentKey } from "@/types/editor";

function summarizeChange(prev: EditState, next: EditState): string {
    if (
        JSON.stringify(prev.crop) !== JSON.stringify(next.crop) ||
        prev.rotation !== next.rotation ||
        prev.flipH !== next.flipH
    ) {
        return "Crop / rotate";
    }

    const changed = (Object.keys(next.adjustments) as AdjustmentKey[])
        .filter((k) => next.adjustments[k] !== prev.adjustments[k])
        .map((k) => ({ key: k, delta: next.adjustments[k] - prev.adjustments[k] }));

    if (changed.length === 0) return "No change";

    const sorted = [...changed].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const top = sorted[0]!;
    const label = ADJUSTMENT_DEFS.find((d) => d.key === top.key)?.label ?? top.key;
    const sign = top.delta > 0 ? "+" : "";
    const extra = changed.length > 1 ? ` +${changed.length - 1} more` : "";
    return `${label} ${sign}${Math.round(top.delta)}${extra}`;
}

export function HistoryPanel() {
    const { state, jumpToHistory } = useEditor();
    const [open, setOpen] = useState(false);

    const timeline = [...state.past, state.edit, ...state.future];
    const currentIndex = state.past.length;

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    disabled={timeline.length <= 1}
                    className="rounded-md p-2 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary disabled:opacity-30"
                    aria-label="History"
                >
                    <HistoryIcon className="h-4 w-4" />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    sideOffset={8}
                    align="end"
                    className="z-50 max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-border bg-surface-elevated p-sm shadow-strong"
                >
                    <p className="mb-xs px-sm text-[12px] uppercase tracking-[0.14em] text-text-muted">
                        History
                    </p>
                    <ul className="flex flex-col-reverse gap-0.5">
                        {timeline.map((entry, i) => {
                            const isCurrent = i === currentIndex;
                            const label = i === 0 ? "Original" : summarizeChange(timeline[i - 1]!, entry);
                            return (
                                <li key={i}>
                                    <button
                                        type="button"
                                        onClick={() => jumpToHistory(i)}
                                        className={`flex w-full items-center justify-between gap-sm rounded-md px-sm py-1.5 text-left text-[13px] transition-colors duration-150 ${isCurrent
                                                ? "bg-accent/10 text-accent"
                                                : "text-text-secondary hover:bg-surface hover:text-text-primary"
                                            }`}
                                    >
                                        <span className="truncate">{label}</span>
                                        {isCurrent && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
