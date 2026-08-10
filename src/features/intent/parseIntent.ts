import type { AdjustmentKey } from "@/types/editor";

export type IntentSuggestion = {
  label: string;
  description: string;
  patch: Partial<Record<AdjustmentKey, number>>;
  requiresCloud?: boolean;
};

type Rule = {
  match: RegExp;
  build: (intensity: number) => IntentSuggestion;
  cloud?: boolean;
};

/**
 * Local, deterministic intent parser. It never applies anything on its own —
 * it proposes a parameter patch that the user approves. A cloud AI service can
 * later replace `parseIntent` with the same suggestion contract.
 */
const RULES: Rule[] = [
  {
    match: /(bright|lighter|light it|too dark|expose)/i,
    build: (i) => ({
      label: "Brighten",
      description: "Lifts exposure and opens the shadows.",
      patch: { exposure: 18 * i, shadows: 15 * i },
    }),
  },
  {
    match: /(dark(er)?|moody|dim)/i,
    build: (i) => ({
      label: "Darken",
      description: "Pulls exposure down and deepens the blacks.",
      patch: { exposure: -16 * i, blacks: -12 * i },
    }),
  },
  {
    match: /(dramatic|punch|contrast|sky)/i,
    build: (i) => ({
      label: "Add drama",
      description: "Stronger contrast, recovered highlights, deeper clarity.",
      patch: { contrast: 25 * i, highlights: -30 * i, clarity: 22 * i, blacks: -12 * i },
    }),
  },
  {
    match: /(warm|golden|sunset|cozy)/i,
    build: (i) => ({
      label: "Warm it up",
      description: "Shifts white balance towards golden tones.",
      patch: { temperature: 28 * i },
    }),
  },
  {
    match: /(cool|cold|blue|icy)/i,
    build: (i) => ({
      label: "Cool it down",
      description: "Shifts white balance towards blue.",
      patch: { temperature: -28 * i },
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
  { match: /(remove|erase|delete)\s+(the\s+)?\w+/i, label: "Object removal", description: "Erasing objects needs Pictoe's cloud engine." },
  { match: /(expand|extend|uncrop|outpaint)/i, label: "Generative expansion", description: "Expanding beyond the frame needs Pictoe's cloud engine." },
  { match: /(replace|swap)\s+(the\s+)?(sky|background)/i, label: "Sky & background replacement", description: "Replacement needs Pictoe's cloud engine." },
  { match: /(cut out|isolate|mask)\s+(the\s+)?(subject|person)/i, label: "Subject isolation", description: "Segmentation needs Pictoe's cloud engine." },
];

function intensityOf(text: string) {
  if (/(slight|little|bit|subtle|touch)/i.test(text)) return 0.5;
  if (/(very|much|lot|way|super|really|strong|dramatic)/i.test(text)) return 1.5;
  return 1;
}

export function parseIntent(input: string): {
  suggestions: IntentSuggestion[];
  cloudOnly: { label: string; description: string } | null;
} {
  const text = input.trim();
  if (!text) return { suggestions: [], cloudOnly: null };

  const cloud = CLOUD_RULES.find((r) => r.match.test(text));
  if (cloud) return { suggestions: [], cloudOnly: { label: cloud.label, description: cloud.description } };

  const i = intensityOf(text);
  const suggestions = RULES.filter((r) => r.match.test(text)).map((r) => {
    const s = r.build(i);
    return {
      ...s,
      patch: Object.fromEntries(
        Object.entries(s.patch).map(([k, v]) => [k, Math.round(Math.max(-100, Math.min(100, v as number)))]),
      ) as Partial<Record<AdjustmentKey, number>>,
    };
  });

  return { suggestions: suggestions.slice(0, 3), cloudOnly: null };
}
