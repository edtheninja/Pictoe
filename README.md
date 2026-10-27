# Pictoe

**Your image. Your intent. Your control.**

Pictoe is a canvas-first image editor that gives you professional control without making you learn a professional tool first. Beginners can improve a photo in seconds. Experienced editors can reach precise, local, non-destructive controls in the same workspace.

The idea behind it is **progressive power**: complexity is revealed when you need it, never removed. The image stays the centre of attention, and the interface stays quiet.

> **Status:** active development · milestones 1–5 complete, most of 6, clone tool built (browser check pending) · type-check, lint, unit tests and production build run in CI
> **Docs:** [PRD.md](./PRD.md) (what and why) · [ROADMAP.md](./ROADMAP.md) (what's next)

---

## What Pictoe can do today

### Editing
- **14 non-destructive global adjustments**, grouped as **Light** (exposure, brightness, contrast, highlights, shadows, whites, blacks), **Color** (saturation, vibrance, temperature, tint) and **Detail** (clarity, sharpness, blur). Basic controls show first; "More controls" reveals the rest.
- **Per-colour saturation** for red, orange, yellow, green, blue and purple, so you can lift the greens without touching skin tones.
- **Crop** with aspect-ratio presets, 90° rotation and horizontal flip.
- **Local areas ("Local" tool).** Paint a region with a brush, then give that area its own exposure, contrast, saturation and temperature. Stack as many areas as you like. The brush has adjustable size and softness, plus an eraser. Areas have their own undo/redo and are saved with your session.
- **Clone tool.** Pick a clean area as the source, then paint over a blemish. Every stroke is saved as data, so a whole drag is one undo step and the strokes follow your crop, rotation and flip.
- **Presets.** Five built-in looks (Warm Film, Moody B&W, Vivid Pop, Cool Blue, Soft Portrait) plus your own, saved locally.

### Control and safety
- **Fully non-destructive.** Your original file is never modified. Every edit is structured data applied at render and export time.
- **Undo / redo** with a **history panel** that lists every state in plain language ("Exposure +18", "Crop / rotate"). Click any entry to jump straight to it.
- **Hold to compare** with the original, plus a keyboard-accessible toggle.
- **Session restore.** Close the tab and come back: your last photo, edits and local areas return automatically. Closing an image explicitly clears the saved session.

### Intent Bar
Type what you want (*"make it warmer"*, *"add drama"*). Pictoe **proposes** a specific adjustment and previews it live. You can apply it or dismiss it; nothing is ever applied silently.

- Suggestions are **image-aware**. A local analysis of the photo (brightness, clipping, colour cast) means "brighten" does more on a dark photo than a bright one.
- On an unedited photo that is clearly too dark or too bright, Pictoe offers a fix **without you typing anything**.
- Requests that need a cloud engine (object removal, sky replacement, generative expansion, subject isolation) are **recognised and clearly labelled as unavailable**. Pictoe does not pretend to do them.

### Export
JPG, PNG or WebP. For JPG and WebP, choose High / Medium / Small or set a custom 1–100% quality. Local areas are included in the exported image. Safari can't save WebP from a canvas, so Pictoe detects that and disables the WebP option there, and a saved file always has the extension of its real format.

---

## Privacy

Everything above runs **in your browser**. Your images are never uploaded and there are no accounts. The only outside request the app makes is loading the Inter font from Google Fonts. Presets and your saved session live in your browser's IndexedDB.

When cloud features are added (see below), they will be **opt-in per operation**, with an explicit consent step before any image leaves your device.

---

## Getting started

You need Node.js and npm.

```sh
git clone https://github.com/edtheninja/Pictoe.git
cd Pictoe
npm install
npm run dev
```

Then open <http://localhost:8080>.

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (targets Cloudflare via the Nitro `cloudflare-module` preset) |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | Type-check without building |
| `npm test` | Run the unit tests (Vitest) |
| `npm run test:watch` | Re-run tests as you edit |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

---

## How it works

```
UI components
     ↓
EditorContext   reducer: edit state · history · local areas · viewport · session
     ↓
Engine          pure TypeScript, no React
  ├─ image/load.ts      decode and validate
  ├─ image/render.ts    one pipeline for preview AND export
  ├─ image/analyze.ts   client-side image statistics
  └─ storage/           IndexedDB: session, presets
```

**Rendering order:** crop/rotate/flip + CSS-filter adjustments → tone layers → per-colour saturation → sharpen → local areas, each stacked on everything before it.

**Design rules**
- The original image is immutable.
- The preview and the export use the same pipeline, so what you see is what you get. The preview is downscaled to what the screen can show; export uses full resolution.
- Local areas are stored as **resolution-independent brush strokes**, so a mask painted on a small preview lines up exactly at export size. They are stored relative to the original image, so they stay on the same part of the picture when you crop, rotate or flip.
- No image-processing logic lives in UI components.

**Stack:** React 19 · TypeScript · Vite 8 · TanStack Router / Start · Tailwind CSS 4 · Radix UI · lucide-react · React Query · Zod

### Project structure
```
src/
├── components/
│   ├── canvas/      Canvas, CanvasControls, CropOverlay, MaskOverlay, HealOverlay
│   ├── controls/    AdjustmentSlider
│   ├── editor/      Editor, EditorHeader, HistoryPanel, AdjustmentPanel,
│   │                BeforeAfter, ExportControl, ImportScreen, ToolDock
│   └── ui/          Radix / shadcn-style primitives
├── engine/
│   ├── image/       load, render, analyze, cloneStamp, healedSource
│   └── storage/     session, presets (IndexedDB)
├── features/
│   ├── adjustments/ AdjustmentGroup
│   ├── crop/        CropTool
│   ├── heal/        HealPanel
│   ├── intent/      IntentBar, parseIntent
│   ├── masks/       MaskPanel
│   └── presets/     PresetsPanel, builtinPresets
├── hooks/           keyboard shortcuts, responsive helpers
├── state/editor/    EditorContext (React wiring, session), editorReducer (history, local areas, clone strokes)
├── types/editor.ts  shared types and defaults
└── routes/          TanStack Router routes
```

---

## Known limitations

Being upfront about what isn't finished:

- **The clone tool is new.** Clone-stamp strokes are stored as non-destructive data and the pixel maths, undo behaviour and crop/rotate/flip handling are unit-tested, but it has **not been tried in a browser or on a touch device yet**. AI-assisted heal needs the cloud engine (M11).
- **Limited automated tests.** Vitest covers undo/redo history, local areas, the intent parser, the mask cache, mask coordinates, where the renderer draws mask brushes, and the clone tool's pixel maths and coordinate handling. The UI, the renderer's full pixel output and end-to-end flows are not tested yet.
- **Safari and iOS use a slower fallback.** Those browsers ship the canvas `filter` API switched off, so Pictoe detects that and applies exposure, contrast, saturation, blur and sharpening with pixel maths instead. It is unit-tested against the CSS filter formulas but **has not been tried on a real Safari or iPhone yet**. Blur is an approximation, and large photos will be slower there.
- **Heavy pixel work runs on the main thread** (sharpening, per-colour saturation, local-area compositing). Very large photos may feel slow.
- **Touch gestures are new.** Pinch-to-zoom and two-finger pan work in every tool. The gesture maths is unit-tested, but it has **not been tried on a real touch device yet**. Painting local areas is pointer-only, with no keyboard alternative.
- **One image at a time.** Session restore holds a single photo.
- **Tonal controls are an approximation.** Highlights, shadows, whites and blacks use blend layers rather than true luminosity masks.

---

## Future scope

The full plan, with effort and dependencies, is in [ROADMAP.md](./ROADMAP.md). The headline items:

| Stage | Focus |
|---|---|
| **Stabilise** | Mostly done: docs refreshed, first tests added, masks cached, masks now follow crop/rotation/flip. Remaining: confirming the recent mask, Safari and touch work on real devices |
| **M7 · Quality & reach** | Test suite and CI, cross-browser verification, pinch-zoom and touch gestures, move pixel work off the main thread, accessibility pass |
| **M8 · Local editing depth** | Gradient and radial masks, mask management (rename, duplicate, reorder, invert), more per-area controls, full HSL, curves, colour grading, accurate tonal controls |
| **M9 · Heal** | Clone-stamp built and unit-tested, stored as non-destructive strokes. Remaining: confirm in browsers and on a touch device. Spot-heal comes with the cloud engine (M11) |
| **M10 · Workflow & export** | Resolution scaling, filename and metadata options, copy edits between photos, batch apply and export, preset import/export, multi-image library |
| **M11 · Cloud AI** | Object removal, generative expansion, sky and background replacement, subject isolation, AI-assisted heal, LLM-backed intent. All **suggest → preview → approve** |
| **M12 · Ship** | Hosting, PWA/offline, privacy-friendly analytics, docs site |

### Planned Rust backend
Local editing will always work without a network. For the features that can't run in a browser (M11), the plan is an **optional Rust service** (axum + tokio) that acts as a gateway to AI providers: keys stay server-side, jobs are cancellable, images are processed briefly and deleted, and nothing is stored or logged. A first spike (**B0**) now lives in [`backend/`](./backend): a job API with strict validation, a CORS allowlist, size limits, real cancellation and graceful shutdown, covered by 23 tests. It contains no AI yet. After the spike, Rust was chosen for the gateway (the decision and its trade-offs are in [ROADMAP.md](./ROADMAP.md); the spike is described in [`backend/README.md`](./backend/README.md)). Rust may also be used in the browser, compiled to WebAssembly, if profiling shows the pixel loops are the bottleneck.

### Not planned
Social feeds, profiles, community, a template marketplace, collaboration, cloud galleries, an AI *chat* assistant, generative image creation from scratch, a full RAW pipeline, and native mobile apps.

> **Rule for every feature:** does it help the user reach their intended result with less friction while keeping them in control? If not, it doesn't ship.

---

## Contributing

The project is in early development. Before a larger change, read [PRD.md](./PRD.md) and [ROADMAP.md](./ROADMAP.md). Run `npm run typecheck`, `npm test`, `npm run lint` and `npm run build` before pushing; CI runs the same four.

## Licence

Not yet specified.

---

*Originally scaffolded with [Lovable](https://lovable.dev); developed locally since.*
