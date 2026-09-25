# Pictoe

**Your image. Your intent. Your control.**

Pictoe is a canvas-first image editor built around one idea: professional-level
editing power shouldn't require professional-level complexity up front.
Controls are revealed progressively — a beginner can improve a photo in
seconds, and deeper control is always one tap away.

## What Pictoe can do today

**Canvas**

- Zoom (cursor-centered), pan, and automatic fit-to-screen
- Responsive: a docked side panel on desktop, a bottom sheet on mobile —
  not one layout stretched across breakpoints

**Editing engine** — 14 non-destructive adjustments across Light, Color,
and Detail (exposure, brightness, contrast, highlights, shadows, whites,
blacks, saturation, vibrance, temperature, tint, clarity, sharpness, blur),
plus crop with aspect-ratio presets, rotation, and flip. Nothing here
touches the original file — every edit is structured state, applied at
render/export time.

**History**

- Full undo/redo
- A history panel (next to Undo/Redo in the header) lists every past and
  future edit state with a plain-language label (e.g. "Exposure +18",
  "Crop / rotate") — click any entry to jump straight to it, not just
  step-by-step

**Before/After** — hold to compare, plus a keyboard-accessible toggle for
anyone who can't use the gesture.

**Intent Bar** — type what you want ("make it warmer", "add drama") and
Pictoe proposes a specific adjustment patch, previewed live before you
apply or dismiss it. Suggestions scale to the actual photo: a local
image-analysis pass (luminance, clipping, color-temperature bias — all
computed client-side, no network) means "brighten" does more on a
genuinely dark photo than a bright one. Pictoe will also proactively
suggest a fix (e.g. "this looks a little dark") on an unedited image with
no typing required. Object removal, sky replacement, and other
generative/cloud-only operations are recognized and clearly labeled as
requiring an internet connection — they're not implemented yet, and
Pictoe says so rather than pretending to.

**Presets** — five built-in looks (Warm Film, Moody B&W, Vivid Pop, Cool
Blue, Soft Portrait), plus save/delete your own from the current edit
state. Stored locally.

**Session persistence** — close the tab, come back later: your last photo
and its edits are restored automatically (stored locally via IndexedDB).
Closing an image explicitly clears the saved session.

**Export** — JPG, PNG, or WebP, with High/Medium/Small quality presets
plus a custom 1–100% slider for JPG/WebP.

## What's not built yet

- Cloud/AI-dependent operations (object removal, generative expansion, sky
  and background replacement, subject isolation) — architecturally
  anticipated, not implemented
- Selective/local (masked or region-based) adjustments — every adjustment
  currently applies globally to the whole frame
- Advanced color controls (curves, HSL) and batch workflows

## Tech stack

React 19 · TypeScript · Vite 8 · TanStack Router/Start · Tailwind CSS 4 ·
Radix UI · lucide-react · React Query · Zod · Bun (lockfile)

## Project structure

```
src/
├── components/
│   ├── canvas/         Canvas, CanvasControls, CropOverlay
│   ├── controls/       AdjustmentSlider
│   ├── editor/         Editor, EditorHeader, HistoryPanel, AdjustmentPanel,
│   │                   BeforeAfter, ExportControl, ImportScreen, ToolDock
│   └── ui/              Radix/shadcn-style primitives
├── engine/
│   ├── image/           load.ts, render.ts, analyze.ts
│   └── storage/         session.ts, presets.ts (IndexedDB)
├── features/
│   ├── adjustments/     AdjustmentGroup
│   ├── crop/            CropTool
│   ├── intent/          IntentBar, parseIntent
│   └── presets/         PresetsPanel, builtinPresets
├── state/editor/         EditorContext (reducer, undo/redo/history, session)
├── types/editor.ts
└── routes/
```

## Development

```sh
git clone https://github.com/edtheninja/Pictoe.git
cd Pictoe
npm i
npm run dev
```

---

_Originally scaffolded with [Lovable](https://lovable.dev); developed locally since._
