import { useState } from "react";
import { ADJUSTMENT_DEFS } from "@/types/editor";
import { AdjustmentSlider } from "@/components/controls/AdjustmentSlider";

/**
 * Progressive disclosure: basic controls first, advanced revealed on demand.
 */
export function AdjustmentGroup({ group }: { group: "light" | "color" | "detail" }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const defs = ADJUSTMENT_DEFS.filter((d) => d.group === group);
  const basic = defs.filter((d) => d.level === "basic");
  const advanced = defs.filter((d) => d.level === "advanced");

  return (
    <div className="min-w-0">
      {basic.map((def) => (
        <AdjustmentSlider key={def.key} def={def} />
      ))}
      {showAdvanced && advanced.map((def) => <AdjustmentSlider key={def.key} def={def} />)}
      {advanced.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="mt-xs text-[12px] text-text-muted transition-colors duration-150 hover:text-accent"
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? "Fewer controls" : `More controls (${advanced.length})`}
        </button>
      )}
    </div>
  );
}
