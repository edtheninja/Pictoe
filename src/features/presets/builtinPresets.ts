import type { Preset } from "@/types/editor";

export const BUILTIN_PRESETS: Preset[] = [
    {
        id: "builtin-warm-film",
        name: "Warm Film",
        builtin: true,
        adjustments: {
            temperature: 22,
            tint: 4,
            contrast: -8,
            blacks: 18,
            saturation: -8,
            highlights: -10,
        },
    },
    {
        id: "builtin-moody-bw",
        name: "Moody B&W",
        builtin: true,
        adjustments: { saturation: -100, contrast: 22, clarity: 18, blacks: -14, shadows: -10 },
    },
    {
        id: "builtin-vivid-pop",
        name: "Vivid Pop",
        builtin: true,
        adjustments: { vibrance: 35, saturation: 15, contrast: 15, clarity: 15, sharpness: 10 },
    },
    {
        id: "builtin-cool-blue",
        name: "Cool Blue",
        builtin: true,
        adjustments: { temperature: -20, tint: -3, contrast: 8, highlights: -8 },
    },
    {
        id: "builtin-soft-portrait",
        name: "Soft Portrait",
        builtin: true,
        adjustments: { clarity: -18, blur: 6, highlights: -6, saturation: -6 },
    },
];
