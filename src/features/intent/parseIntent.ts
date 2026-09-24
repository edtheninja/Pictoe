import type { AdjustmentKey, ImageAnalysis } from "@/types/editor";

export type IntentSuggestion = {
  label: string;
  description: string;
  patch: Partial<Record<AdjustmentKey, number>>;
  requiresCloud?: boolean;
};

type Rule = {
  match: RegExp;
  build: (intensity: number, analysis: ImageAnalysis | null) => IntentSuggestion;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** Scales a correction's strength by how far the image already is from
 *  "normal" in the relevant direction — e.g. a genuinely dark photo gets a
 *  stronger brighten than one that's already close to well-exposed. */
function exposureFactor(analysis: ImageAnalysis | null, direction: "up" | "down") {
  if (!analysis) return 1;
  const delta = 128 - analysis.avgLuminance; // positive = image is dark
  const signed = direction === "up" ? delta : -delta;
  return clamp(1 + signed / 160, 0.4, 1.8);
}

function warmthFactor(analysis: ImageAnalysis | null, direction: "warm" | "cool") {
  if (!analysis) return 1;
  const signed = direction === "warm" ? -analysis.warmthBias : analysis.warmthBias;
  return clamp(1 + signed * 1.4, 0.4, 1.6);
}

/**
 * Local, deterministic intent parser. It never applies anything on its own —
 * it proposes a parameter patch that the user approves. A cloud AI service can
 * later replace `parseIntent` with the same suggestion contract.
 */
const RULES: Rule[] = [
  {
    match: /(bright|lighter|light it|too dark|expose)/i,
    build: (i, analysis) => {
      const f = i * exposureFactor(analysis, "up");
      return {
        label: "Brighten",
        description: "Lifts exposure and opens the shadows.",
        patch: { exposure: 18 * f, shadows: 15 * f },
      };
    },
  },
  {
    match: /(dark(er)?|moody|dim)/i,
    build: (i, analysis) => {
      const f = i * exposureFactor(analysis, "down");
      return {
        label: "Darken",
        description: "Pulls exposure down and deepens the blacks.",
        patch: { exposure: -16 * f, blacks: -12 * f },
      };
    },
  },
  {
    match: /(dramatic|punch|contrast|sky)/i,
    build: (i, analysis) => {
      const highlightBoost = analysis ? clamp(1 + analysis.highlightClipPct * 6, 1, 2.2) : 1;
      return {
        label: "Add drama",
        description: "Stronger contrast, recovered highlights, deeper clarity.",
        patch: {
          contrast: 25 * i,
          highlights: -30 * i * highlightBoost,
          clarity: 22 * i,
          blacks: -12 * i,
        },
      };
    },
  },
  {
    match: /(warm|golden|sunset|cozy)/i,
    build: (i, analysis) => ({
      label: "Warm it up",
      description: "Shifts white balance towards golden tones.",
      patch: { temperature: 28 * i * warmthFactor(analysis, "warm") },
    }),
  },
  {
    match: /(cool|cold|blue|icy)/i,
    build: (i, analysis) => ({
      label: "Cool it down",
      description: "Shifts white balance towards blue.",
      patch: { temperature: -28 * i * warmthFactor(analysis, "cool") },
    }),
  },
  {
    match: /(pop|vivid|colou?rful|saturat|vibrant)/i,
    build: (i) => ({
      label: "More colour",
      description: "Raises vibrance while protecting skin tones.",
      patch: { vibrance: 30 * i, saturation: 10 * i },
    }),
  },
  {
    match: /(mute|desaturat|black and white|monochrome|b&w)/i,
    build: (i) => ({
      label: "Mute the colour",
      description: "Drops saturation for a quieter palette.",
      patch: { saturation: -60 * i, vibrance: -20 * i },
    }),
  },
  {
    match: /(sharp|crisp|detail|stand out|subject)/i,
    build: (i) => ({
      label: "Sharpen the subject",
      description: "Adds sharpness and local contrast.",
      patch: { sharpness: 40 * i, clarity: 20 * i },
    }),
  },
  {
    match: /(soft|dreamy|blur|hazy)/i,
    build: (i) => ({
      label: "Soften",
      description: "Gentle blur with reduced clarity.",
      patch: { blur: 12 * i, clarity: -18 * i },
    }),
  },
  {
    match: /(flat|film|matte|faded)/i,
    build: (i) => ({
      label: "Faded film",
      description: "Lifted blacks and lower contrast.",
      patch: { blacks: 22 * i, contrast: -14 * i, saturation: -10 * i },
    }),
  },
];

const CLOUD_RULES: { match: RegExp; label: string; description: string }[] = [
  {
    match: /(remove|erase|delete)\s+(the\s+)?\w+/i,
    label: "Object removal",
    description: "Erasing objects needs Pictoe's cloud engine.",
  },
  {
    match: /(expand|extend|uncrop|outpaint)/i,
    label: "Generative expansion",
    description: "Expanding beyond the frame needs Pictoe's cloud engine.",
  },
  {
    match: /(replace|swap)\s+(the\s+)?(sky|background)/i,
    label: "Sky & background replacement",
    description: "Replacement needs Pictoe's cloud engine.",
  },
  {
    match: /(cut out|isolate|mask)\s+(the\s+)?(subject|person)/i,
    label: "Subject isolation",
    description: "Segmentation needs Pictoe's cloud engine.",
  },
];

function intensityOf(text: string) {
  if (/(slight|little|bit|subtle|touch)/i.test(text)) return 0.5;
  if (/(very|much|lot|way|super|really|strong|dramatic)/i.test(text)) return 1.5;
  return 1;
}

export function parseIntent(
  input: string,
  analysis: ImageAnalysis | null = null,
): {
  suggestions: IntentSuggestion[];
  cloudOnly: { label: string; description: string } | null;
} {
  const text = input.trim();
  if (!text) return { suggestions: [], cloudOnly: null };

  const cloud = CLOUD_RULES.find((r) => r.match.test(text));
  if (cloud)
    return { suggestions: [], cloudOnly: { label: cloud.label, description: cloud.description } };

  const i = intensityOf(text);
  const suggestions = RULES.filter((r) => r.match.test(text)).map((r) => {
    const s = r.build(i, analysis);
    return {
      ...s,
      patch: Object.fromEntries(
        Object.entries(s.patch).map(([k, v]) => [
          k,
          Math.round(Math.max(-100, Math.min(100, v as number))),
        ]),
      ) as Partial<Record<AdjustmentKey, number>>,
    };
  });

  return { suggestions: suggestions.slice(0, 3), cloudOnly: null };
}

/**
 * Proactive suggestion generated purely from image analysis, with no text
 * input — surfaced automatically when a genuinely under/overexposed image
 * loads. Returns null when the image looks reasonably well-exposed.
 */
export function analysisSuggestion(analysis: ImageAnalysis): IntentSuggestion | null {
  if (analysis.shadowClipPct > 0.35 || analysis.avgLuminance < 55) {
    return {
      label: "Brighten",
      description: "This looks a little dark — lift the exposure and open the shadows.",
      patch: { exposure: 22, shadows: 20 },
    };
  }
  if (analysis.highlightClipPct > 0.12 || analysis.avgLuminance > 205) {
    return {
      label: "Recover highlights",
      description: "Some areas look blown out — pull the highlights back.",
      patch: { highlights: -35, exposure: -8 },
    };
  }
  return null;
}
