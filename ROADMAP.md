# Pictoe — Roadmap

> **Snapshot:** 7 October 2026 · `main` @ `d140ea3`
> **Companion docs:** [PRD.md](./PRD.md) (what and why) · [README.md](./README.md) (what exists today)
> **Effort key (rough, one developer):** **S** under a day · **M** 1–3 days · **L** a week or more
> **Backend:** a Rust service is planned as a parallel track, see [Backend track](#backend-track--rust-service-runs-in-parallel-with-m7m12)

---

## 1. Where things stand

### Health check (run against current `main`)

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ 0 errors |
| Production build (`vite build`) | ✅ Passes |
| ESLint | ✅ 0 errors, 0 warnings |
| Automated tests | 🟡 105 unit tests (Vitest): history, local areas, intent parser, mask cache, mask coordinates, renderer brush placement. No UI or end-to-end tests yet |
| Size | ~4,100 lines across 39 source files (excluding generated routes and UI primitives) |
| Outbound network calls | Google Fonts (Inter) only. Image data is never uploaded |

> **How this was verified:** type-check, build, lint and code inspection. The UI was **not** run in a browser during this audit. The newest local-mask commits (eraser, brush size/softness, mask undo/redo, mask persistence) are confirmed *present in the code*, not confirmed *working by eye*. Treat them as "needs a manual pass" until you've exercised them.

### What changed since the last documented state

Several features landed that go beyond what the README and earlier notes describe:

| Commit | Change |
|---|---|
| `db76a24` | Mask **eraser** (`MaskStrokeMode = "paint" \| "erase"`) |
| `adc28f6` | **Masks persist** across sessions (`maskLayers` saved alongside the edit state) |
| `42e18c5` / `192aa32` | **Undo/redo for local masks**, as a separate stack (`maskPast` / `maskFuture`) that is active while the Local tool is selected |
| `2bc2202` | Adjustable **brush size and softness** |

This makes several limitations I described earlier out of date: masks *are* now undoable, persisted, erasable and softness-adjustable.

---

## 2. Completed milestones

| # | Milestone | What shipped | Status |
|---|---|---|---|
| 1 | **Foundation & workspace** | Local dev, SSR runtime fix (stale `routeTree.gen.ts`), responsive shell, empty vs editing state, two-sided import screen with loading state | ✅ Done |
| 2 | **Editing workspace** | Zoom/pan/fit canvas, tool dock, contextual panel (docked side panel on desktop, bottom sheet on mobile), hold-to-compare, crop workflow, motion | ✅ Done |
| 3 | **Editing engine** | 14 global adjustments, real unsharp-mask sharpening, crop/rotate/flip, undo/redo, reset, JPG/PNG/WebP export with preset + custom (1–100%) quality | ✅ Done |
| 4 | **Intent-based editing** | Rule-based parser, suggestion cards, **live preview** before Apply, Dismiss, cloud-only intents labelled as unavailable | ✅ Done |
| 5 | **Local intelligence** | Client-side image analysis (luminance, clipping, contrast, warmth), suggestion strength scales to the image, proactive "this looks dark" suggestion | ✅ Done (local scope; cloud deliberately deferred) |
| 6 | **Professional expansion** | Session persistence (IndexedDB), built-in + custom presets, jumpable history panel, per-colour-band saturation (6 bands), local masks (multi-layer brush, 4 parameters each) | 🟡 Mostly done. Remaining items moved to M8–M10 |

---

## 3. Stabilise first — "Milestone 6.5"

These are small, mostly cheap, and make everything after them safer. Do them before starting new features.

| # | Item | Why it matters | Effort |
|---|---|---|---|
| 1 | **Update the README** | It still lists *masks / brush adjustments* and *HSL* under "Not built yet" and as unchecked roadmap items. Both now exist (HSL only as per-band saturation, so keep Curves, full HSL and colour grading as future) | S |
| 2 | ✅ **Reconcile the Heal tool** | Resolved: the clone-stamp work is on `main` (see M9). The panel now holds the real tool; AI-assisted heal stays cloud-only and is labelled as unavailable (M11) | ✅ |
| 3 | ✅ **Masks follow crop, rotation and flip** | Strokes are now stored relative to the *source image* and converted to the visible frame at draw time. Older saved sessions are converted when loaded. Unit-tested against the renderer's own canvas transform. **Still to confirm by eye in a browser** | ✅ |
| 4 | ✅ **Mask rendering cache** | One rasterised mask per layer; painting draws only the new stroke (300 stroke-draws instead of about 45,000 over a 300-stroke session); exports skip the cache | ✅ |
| 5 | **Config hygiene** | **Correction:** the `vite-tsconfig-paths` plugin cannot simply be removed. It is a required peer dependency of `@lovable.dev/vite-tanstack-config`, and the repo's `vite.config.ts` does not add it itself. The dev-server warning stays until that wrapper is upgraded or replaced (see item 6). Package renamed `tanstack_start_ts` → `pictoe` ✅. **Lint is now fully clean:** generated shadcn files are exempt from the fast-refresh rule, and the reducer moved out of `EditorContext.tsx` into `editorReducer.ts` | S |
| 6 | **Decide on Lovable coupling** | `AGENTS.md` and `.lovable/` still tie the repo to Lovable (and warn against rewriting pushed history). `reportLovableError` is a no-op outside the Lovable editor preview. Decide whether to stay connected or detach cleanly | S |
| 7 | ✅ **First automated tests** | Vitest with 105 tests; more to add in M7 | ✅ |

---

## 4. Upcoming milestones

### M7 — Quality & reach *(hardening)*

**Goal:** make what exists trustworthy on more devices and for more people.

- [x] **Test suite + CI** (M). **Confirmed done by the owner:** the first CI run on GitHub was green. Started: a GitHub Actions workflow (`.github/workflows/ci.yml`: frozen Bun install, typecheck, lint, tests, build) is added and passes locally from a clean install; tick this after its first green run on GitHub. A second CI job runs Playwright end-to-end tests (`e2e/`: clone tool flow, panel-never-covers-photo layout check at phone/tablet/desktop sizes). They caught two real bugs while being written: dead keyboard shortcuts and a tool sheet covering the photo on phones. `bun.lock` was out of sync with `package.json` (vitest missing) and is refreshed. Tests already cover reducer history and local areas, the intent parser, the mask cache, mask coordinates and renderer brush placement. Remaining targets, in priority order:
  - Reducer: `undo` / `redo` / `jumpTo`, mask history, `closeImage`, `restoreSession`
  - `parseIntent` (rules, intensity words, cloud-only detection) and `analysisSuggestion` thresholds
  - `analyzeImage` against synthetic dark / bright / warm / cool images
  - History label diffing (`summarizeChange`)
  - A render smoke test (known input → expected pixel ranges)
  - Playwright e2e: import → edit → undo → export → reload → restored
- [x] **Cross-browser verification** (M). **Confirmed done by the owner;** since then the `e2e:devices` Playwright projects run the Heal flows on WebKit (Safari's engine), an iPhone profile and a Pixel profile. **Found:** Safari and iOS Safari ship canvas `ctx.filter` disabled by default (caniuse: Safari 18.0 through 26.x), so every filter-based adjustment would have silently done nothing there. **Done:** feature detection plus a pixel-maths fallback (`canvasFilter.ts`), unit-tested against the CSS filter formulas. **Also done:** WebP export is detected and disabled where the browser can't encode it (Safari silently returns a PNG), and exported files always get the right extension. **Still to do:** try it on real Safari and iOS devices; check session restore and touch behaviour
- [x] **Touch gestures** (M). Pinch-to-zoom and two-finger pan are built for every tool with unit-tested gesture maths, and a second finger no longer paints in the Local tool. **Still to do:** try on a real phone or tablet. Known quirk: a tiny dab can appear under the first finger when a pinch starts in the Local tool (mask undo removes it)
- [x] **Move heavy pixel work off the main thread** (L). **Confirmed done by the owner.** Sharpening, colour-band saturation and mask compositing all loop over pixels synchronously. **Profile (3 Nov 2026, Node/V8 timings of the pure-JS loops only, synthetic photo data; no browser available, so GPU, `getImageData` transfer and `ctx.filter` costs are unmeasured):** colour bands were the worst stage (about 100-130 ms at 1.7 MP and 350 ms at 3.8 MP with one band, up to 1.2 s with all six; export at 24 MP up to about 7 s); the Safari fallback blur costs about 215 ms at 1.7 MP and 510 ms at 3.8 MP; the sharpen combine loop is cheap (about 50 ms). A 60 fps frame is 16 ms. A Worker stops these blocking the UI but does not make them faster, so the order is: (1) **done:** allocation-free colour-band loop in `colorBands.ts` (1.6-4x faster, within one level of the old output, tested against the old implementation) plus an opt-in timing harness (`?profile`, then `__pictoeProfile.summary()` in the console) to get real per-stage numbers on Chrome and Safari; (2) **done:** the render pipeline no longer needs `document`: scratch canvases (`sharpen`, local masks, healed source, the `ctx.filter` probe) come from `canvasFactory.ts`, which uses the DOM when present and `OffscreenCanvas` otherwise, and a test runs every stage with no `document` (still on the main thread: `analyze.ts`, the export-format probe and the export canvas in `exportImageSafely`, which use `toBlob`); (3) **done, awaiting real-browser confirmation:** the preview renders in a Worker (`render.worker.ts`, `renderHandler.ts`, `renderClient.ts`; the source image goes over once as a transferred `ImageBitmap`, each frame comes back as a transferred `ImageBitmap`, one render runs at a time and only the newest waiting request is kept), with automatic fallback to main-thread rendering if the Worker, `OffscreenCanvas` or the bitmap is unavailable or fails; open with `?noworker` (or `localStorage.pictoeWorker = "0"`) to force the main-thread path for comparison. Export still renders on the main thread. Options for the heavy loops after that: WebGL/WebGPU, or Rust compiled to WASM in a Worker (see Backend track). Real-browser numbers decide whether (3) and the Safari blur need more than this.
- [x] **Large-image guardrails** (S). Photos over 100 MP (or with a side over 32,767 px) are refused with a clear message, decided from the file header before any decoding, so a file that merely *claims* a huge size can't exhaust memory. Export tries the full size first and steps down (75 %, 50 %, …) when the browser can't make or encode a canvas that large, then tells the user the size it saved. Unit-tested (header reader for JPEG/PNG/WebP, limits, fallback) and covered by browser tests, including one that makes the browser refuse large canvases. *Still open:* Safari/iPhone limits are unverified on a real device, and editing a photo near the limit is still heavy (the whole decoded image stays in memory).
- [x] **Accessibility pass** (M). Automated axe scan (WCAG 2.0 / 2.1 / 2.2 A and AA plus best practice) now runs in CI on the import screen, the editor, every tool panel and the export dialog at desktop and phone sizes, and finds nothing. Fixed what it found: invalid ARIA on the sliders, muted-text contrast in both themes (it was 3.9:1 on raised surfaces), no page heading, an unnamed export dialog, and nested interactive controls in crop. Crop is now keyboard-operable (arrows move, Alt/Option + arrows resize, Shift for bigger steps, changes announced) with one undo step per gesture; this also fixed the crop drag recording an undo entry on every mouse move (one drag took 10 undos to reverse). Tab reach, visible focus, slider names and `prefers-reduced-motion` are covered by browser tests. *Still open:* mask painting and the clone tool are pointer-only (documented in the README); nothing has been tried with a real screen reader (VoiceOver, NVDA) or at 200 % / 400 % zoom, and axe only catches part of what matters.

**Done when:** CI runs `tsc` + lint + tests on every push; the core flow is covered end to end; the app is confirmed working (or gracefully degraded) on Safari, Chrome and Firefox.

---

### M8 — Local editing depth *(the "pro" milestone)*

**Goal:** close the biggest remaining gap between Pictoe and a serious editor.

- [x] **More mask shapes** (L): linear gradient and radial masks alongside the brush (model in step 7, handles in step 8)
- [x] **Mask management** (M): rename, duplicate, reorder, invert, show/hide toggle, thumbnails
- [x] **More per-area parameters** (M): highlights, shadows, clarity, sharpness, tint, alongside exposure, contrast, saturation, temperature (step 9)
- [ ] **Full HSL** (M): hue and luminance per colour band (saturation per band already ships)
- [x] **Curves**: RGB and luminance tone curves in the colour stage (`curves.ts`), with a pointer- and keyboard-driven editor in a new Curves tool; per-channel (R, G, B) curves are not built yet
- [ ] **Colour grading** (M): shadows / mids / highlights wheels
- [x] **Tonal accuracy** (L): highlights, shadows, whites and blacks are true luminosity-weighted adjustments in the colour stage (`tonal.ts`), replacing the flat blend-mode layers

**Done when:** a user can brighten a face with a radial mask, cool a sky with a gradient, and fine-tune greens with hue/saturation/luminance, all non-destructively and all surviving a reload. (Covered end to end by `e2e/donewhen.spec.ts`; step 10.)

**Sequence of work.** Most of M8 is per-pixel colour maths, so one shared colour stage comes first and the features build on it; mask work follows. Each step ships as its own tested patch.

1. [x] **Session schema version and tolerant restore** (S): `sessionSchema.ts` normalises whatever is saved (fills in adjustments an older save lacks, clamps to slider ranges, repairs or drops invalid strokes, layers and crops); saves are stamped with `schemaVersion`. Needed because M8 adds adjustment keys and mask fields, and the old restore (a shallow merge) would have left new adjustment keys `undefined` for existing sessions.
2. [x] **Unified colour stage** (M): `colorStage.ts` plans the frame once (`planColorStage`, null when nothing is active so the pixel pass is skipped) and applies every per-pixel colour operation in one `getImageData`/`putImageData` pass; colour bands moved in with byte-identical output and the same speed (A/B against the old loop). `npm run bench` times the stage on your machine. Today the stage holds only colour bands (sandbox Node timings: about 80-110 ms at 1.7 MP with one band, 135-160 ms with six), so the **performance gate is re-measured as tonal accuracy and curves land**: if the stage costs more than about 150 ms at 1.7 MP in a real browser, make it WebGL before building further on it.
3. [x] **Tonal accuracy** (L): `tonal.ts` weights each slider by the pixel's own luminance (shadows and highlights act over roughly the lower and upper halves, blacks and whites only at the extreme ends, mid-tones barely move) and the colour stage shifts luminance by that amount in the same pass as colour bands; the four blend-mode layers are gone, temperature and tint are unchanged. **Decision: the look shift is accepted** (no legacy mode, no schema bump). The old layers weighted the mid-tones most (highlights +100 lifted mid-tones several times more than highlights), so saved edits and built-in presets that use these sliders look different now; full-slider strengths are 0.22 of the luminance range for shadows and highlights and 0.10 for blacks and whites, adjustable in `TONAL_STRENGTH`. Stage cost (sandbox Node, 1.7 MP): tonal alone about 40 ms, tonal plus one colour band about 145 ms, so the colour-band section (full HSL per pixel) is what to speed up first; see the performance gate in step 2.
4. [x] **Curves** (L): two curves, RGB (each channel through the same curve, so it can shift colour) and Luminance (brightness only, colour kept), each a monotone cubic spline through up to 16 points (no overshoot between points; end points move only up and down). Applied in the colour stage after tonal and before colour bands. New Curves tool: click the graph to add a point and drag it, arrow keys move a focused point (Shift for bigger steps), Delete removes it, plus Add point / Remove point / Reset curve buttons for touch and keyboard. A drag or a held key is one undo step. Stored in `EditState.curves`; old saves open with straight curves (session normaliser), Show original and Reset all include curves, history labels them. Stage cost (sandbox Node, 1.7 MP): RGB curve about 10 ms, RGB plus luminance about 50 ms, tonal plus both curves plus one colour band about 185 ms, so **the stage is now past the roughly 150 ms gate in this sandbox**: the next speed-up is in step 5 (skip the HSL conversion for pixels no band touches, and share one luminance computation between tonal and the luminance curve), before considering WebGL. Not yet built: per-channel curves, a histogram behind the graph.
5. [x] **Full HSL** (M): the colour mixer now has hue, saturation and luminance for each of six bands (18 adjustments: `hueRed`...`lumPurple`; the six saturation keys are unchanged, so old saves keep their look). Hue turns a band's colours up to 30 degrees at a full slider (positive turns towards the next band, red to orange); luminance changes HSL lightness by up to half the available range toward white (positive) or black (negative); overlapping bands add and luminance is limited to the range. The Color tool's "More controls" now holds a colour mixer: pick a band from six swatches (a dot marks bands you have adjusted), then adjust its three sliders, instead of eighteen sliders in a row. Pixels whose hue no band touches are skipped before any lightness or saturation maths (output byte-identical to before; measured speed-up only about 5%, so the cost is mostly the per-pixel hue and HSL conversion, not what was skipped; a reciprocal-table hue calculation was tried and gave no clear gain, so it was not kept). Stage cost is therefore unchanged (sandbox Node, 1.7 MP: one band about 65 ms, six bands about 120 ms, tonal plus both curves plus one band about 145 ms); further speed means moving the stage to the GPU.
6. [x] **Colour grading** (M): a tint and a luminance shift for each of three tonal ranges (shadows, mid-tones, highlights) plus a balance (10 adjustments, `gradeShadowsHue`...`gradeBalance`; hue 0-360, saturation 0-100, luminance and balance -100 to 100). `grading.ts` weights each range by luminance using the same smooth weights as the tonal sliders (the three always add up to exactly 1; balance slides the split by up to 0.25 of the luminance range) and applies the grade as one lookup per pixel, last in the colour stage and also to greys (the colour mixer skips greys). A tint is its hue at its saturation as a change to red, green and blue with zero net luminance, so tinting never brightens or darkens; a full tint at full weight is about 40 levels (`TINT_STRENGTH` 0.2), a full luminance slider about 38 (`GRADE_LUM_SHIFT` 0.15). The Color tool's "More controls" now holds the colour mixer and a "Colour grading" section: pick a range (its swatch shows the tint), then three sliders, plus Balance. Done with sliders, not colour wheels. Not built: the Lightroom-style **blending** control (width of the overlap between ranges; the overlap is fixed) and wheels. Stage cost (sandbox Node, 1.7 MP): grading alone about 38 ms, the same as tonal; everything at once (tonal, both curves, one mixer band) about 145-170 ms.
7. [x] **Mask model v2** (L): the data model, renderer, state actions and session restore for gradient masks and layer management; no UI yet (that is step 8). A `MaskLayer` is now a brush layer (no `shape`, built from `strokes`) or a gradient layer (a `shape`, no strokes), plus optional `invert` and `visible` flags that are stored only when they differ from the default, so old saves read exactly as before (no schema bump; `sessionSchema.ts` normalises shape, invert and visible). **Linear**: full effect at the start point, a straight fade to none at the end point, constant beyond both. **Radial**: an ellipse (centre, two half-axes as fractions of the source's shorter side, an angle in degrees, and a feather 0-100 measured inwards from the edge). Both are stored in source space, so they follow crop, rotation and flip like brush strokes; `maskShapes.ts` holds the geometry (`linearToPixels`, `radialToPixels`, a plain-maths `shapeCoverage` that tests the same definition the canvas gradients draw) and `sanitizeShape`, which the reducer and the session loader share. The renderer draws a gradient as one canvas gradient fill (not cached, since that is cheaper than keeping a canvas), and **invert** keeps the filtered copy everywhere except the mask (`destination-out` instead of `destination-in`), for brush and gradient layers alike. New reducer actions, each one undo step on the mask history: `addMaskLayer` takes an optional `shape`; `duplicateMaskLayer` (the copy goes straight after the original and is selected), `renameMaskLayer` (trimmed, 60 characters, empty or unchanged ignored), `setMaskLayerInverted`, `setMaskLayerVisible`, `moveMaskLayer` (array order is render order, last on top; the index is clamped). `setMaskShape` is live like painting (the overlay brackets a whole drag with `recordMaskHistory`) and only reshapes a gradient layer of the same kind; painting on a gradient layer does nothing. **Decisions:** a hidden layer has no effect on the preview *or* the export (it is switched off, not just its overlay); an empty brush layer that is inverted covers the whole picture (the inverse of nothing), an empty one that is not does nothing as before; a saved shape that cannot be repaired (unknown kind, non-numbers, a linear gradient whose two points coincide) is dropped and the layer is kept as an empty brush layer with its adjustments, rather than discarding the layer; positions are kept within -1 to 2 of the picture and radii within 0.005-2. Not built: any way to create or edit these in the UI (step 8), hit-testing handles, a gradient mask cache, gradient layers in the intent parser. 8. [x] **Mask UI** (L): the Local tool now adds three kinds of area (Brush, Linear, Radial). A gradient area is edited with handles on the photo: linear has a start and an end handle with guide lines; radial has a centre handle (move), an x-radius handle (size and rotate), a y-radius handle and a feather handle, plus a Feather slider. Handles are focusable buttons: drag with a pointer or nudge with the arrow keys (Shift for bigger steps); one drag or one key press is one undo step; they keep their size when you zoom, and a second finger still pinches. The maths is in `maskHandles.ts` (pure, tested in every crop/rotation/flip combination: dropping a handle where it is changes nothing, a dragged handle ends under the pointer). The area list shows a thumbnail of what each area covers (it follows crop, rotation and flip), a show/hide eye, delete, and for the selected area invert, duplicate, rename (inline; Enter saves, Escape cancels) and move up/down buttons, so reordering needs no dragging and works from the keyboard. Brush size, softness and Paint/Erase show only for brush areas. Tested: 40 new unit tests; `e2e/masks.spec.ts` (radial brightens inside and not outside, hide/show, drag then one undo, arrow-key nudge, rename/reorder/invert/duplicate, survives a reload) is written but **has not been run in a browser yet**. Not built: dragging rows to reorder, a handle for the whole linear line, per-channel mask thumbnails for hidden areas, a gradient mask cache, and trying it on a real touch screen.
9. [x] **More per-area parameters** (M): a local area now has nine sliders. The original four (exposure, contrast, saturation, temperature) stay up front; highlights, shadows, tint, clarity and sharpness sit behind "More controls (5)", the same disclosure as the global panels. Each area's scratch canvas now runs this chain before it is cut to the mask: canvas filter (exposure, contrast + clarity, saturation), colour casts (temperature, tint), the colour stage (highlights, shadows; the same luminosity-weighted maths as the global sliders, one pixel pass only when either is non-zero), then an unsharp mask (sharpness, only when above zero). Scales match the global sliders of the same name; clarity is the app's clarity (a contrast boost of 0.25 at full), not a separate local-contrast filter. The chain lives in `localAdjustments.ts` (pure) and `applyMaskLayer`. Saves from before this step open with the new sliders at 0 (`sessionSchema.ts` clamps each to its own range; sharpness has no negative side); `LOCAL_ADJUSTMENT_DEFS` in `types/editor.ts` is the one list of sliders, ranges and basic/advanced level. Tested: 24 new unit tests (slider definitions, filter scales, highlights/shadows identical to the global maths, schema repair and old saves, reducer defaults and duplicate, each new slider reaching the right render step through the real renderer, with deliberate breakages caught) and a browser test in `e2e/masks.spec.ts` (written, not yet run). Not built: per-area curves or colour mixer, a true local-contrast clarity, presets that include areas.
10. [x] **"Done when" end-to-end test** (M) and a profile pass.
    - **End-to-end:** `e2e/donewhen.spec.ts` follows the milestone sentence on the test photo (the red circle stands in for a face, the blue top for a sky, the green square for greens): drag a radial area onto the face and raise exposure; add a gradient from the top edge to 60% and cool it; open the colour mixer and set the green band's hue, saturation and luminance; then reload and check that every pixel comes back, that both areas are still listed, and that the three mixer values are still set. It also checks the plain background never changed, and that switching both areas off returns the original face and sky (non-destructive). Expected pixel changes were worked out by hand (cooling: red 90 to about 79, blue 200 to about 209; brightening: the circle's green channel 30 to about 46) and the thresholds sit well inside them. **Written, not yet run in a browser.**
    - **Profile (Node, 14 Nov 2026; synthetic photo data; no browser, so GPU, `getImageData` transfer and canvas-filter costs are unmeasured):** a local area's own pixel work (highlights and shadows, the only per-pixel step besides sharpening) costs about 46 ms at 1.7 MP, 97 ms at 3.8 MP and 670 ms at 24 MP, per area, per frame. Counted exactly with the real renderer (`render.budget.test.ts`, pinned so it cannot grow unnoticed): a filter-only area reads no pixels; highlights and shadows add one full-frame read and write; sharpness adds two reads, a write and a scratch canvas; an area with every slider moved costs 3 reads, 2 writes and 3 canvases; cost grows in a straight line with the number of areas and is the same for brush, linear and radial. So three fully adjusted areas read about 9 full frames per preview frame (about 140 MB at 3.8 MP) and, for highlights and shadows alone, would take roughly 140-290 ms of pixel loops at the preview sizes, past the point where a slider drag feels laggy on the main thread. The Worker (M7 step 3) keeps that off the UI thread but does not make it faster.
    - **Done in this pass:** an area whose sliders are all at zero is now skipped (`layerHasEffect`); before, every freshly added or reset area cost two full-frame canvases per frame to paint back an identical copy.
    - **Next, not done:** limit each area's scratch work to the area's bounding box (a radial area and a short brush area cover a fraction of the frame, yet every pixel is read, processed and written back), fuse highlights/shadows and sharpness into one read, and cache gradient masks like brush masks. Real-browser numbers (`?profile`, then `__pictoeProfile.summary()`) should decide which of these is worth the risk.

---

### M9 — Heal *(local first)* — ✅ built and tested; three follow-ups need a person and a real device

**Goal:** spot healing and clone-stamp without needing a network.

- [x] Add a `HealStroke` type to the **non-destructive edit model** (source offset, radius, softness) so strokes are data, not baked pixels
- [x] Render pass: clone from a **snapshot taken before the write** (prevents self-copy artefacts)
- [x] Tap-to-set-source, drag-to-paint overlay (reuse the zoom/pan-aware coordinate mapping from `CropOverlay` / `MaskOverlay`)
- [x] Bundle a whole drag into a single undo step
- [x] Persist heal strokes with the session

**Spot healing (added 15 Nov 2026).** The goal above says "spot healing and clone-stamp", but only the clone stamp was built: a stroke copies source pixels as they are, and nothing blends tone or picks a source. These steps add the missing half on the same `HealStroke` model, one verified step at a time:

1. [x] **Data:** a stroke has an optional `mode` (`"clone"` or `"heal"`; absent means clone, so every stroke and saved session from before opens unchanged). `healModeOf()` reads it, `normalizeHealStrokes` keeps a valid mode and leaves off an unknown one (a mode from a newer build reads as clone, so the edit is kept), and the mode reaches the pixel layer through `dabFromStroke`. A heal-mode stroke is painted exactly like a clone until step 2. Nothing in the UI creates heal strokes yet.
2. [x] **Blend maths:** `healBlend.ts` (pure, no DOM). A heal dab copies the source's texture but takes its colour and brightness from around the target: it measures a ring just outside the dab (target minus source, averaged in 32 angular sectors, per colour channel), then fills the inside with the smoothest surface that matches the ring (the harmonic function, the closed form of seamless cloning on a disc: each angular frequency k fades towards the centre as ρ^k, evaluated relative to the ring's measured mean radius so a smooth gradient is reproduced exactly). Pixels are the source sample plus that offset, clamped to 0-255 before the soft-edge mix; alpha is never offset; with nothing to measure (ring off the image or the source) it is exactly a clone. `dabReach` and `dabRects` read the extra ring for heal dabs; `paintDab` picks heal or clone by mode; `cloneDab` now shares one bilinear sampler (`sampleSource`) with it, behaviour unchanged. Not yet called by the renderer: `applyStrokes` still clones until step 5. Tested with 21 new unit tests on hand-checkable scenes (brighter source matched to a darker target with a blemish fully covered; a linear ramp reproduced to within 2.5 levels; texture kept; per-channel colour cast corrected; soft edge, alpha, clamping, partial and missing rings, cut-out patches equal to whole-image), and six deliberate breakages of the maths (flipped sign, wrong radius, no clamp, no gradient term, alpha offset, ring including the blemish) were each caught. **Cost** (Node, 3000 x 2000 image): about 3 times a clone, 1.2 ms at radius 30 px, 4 ms at 60, 18 ms at 120, 73 ms at 240 (clone: 0.4, 1.3, 5, 33), so step 5 must paint a drag's dabs incrementally.
3. [x] **Auto source:** `autoSource.ts` (pure, no DOM, no randomness). `findAutoSource(patch, imgW, imgH, spot)` returns the offset to copy from for a one-tap spot heal, or null when there is nowhere to look (the spot's own surroundings are mostly off the picture, or no candidate fits without touching the spot). A fixed fan of 16 directions x 6 distances (geometric, from the spot's radius plus the ring up to the search range) plus one refinement round of 8 neighbours, so never more than 104 candidates, each scored on a fixed 48 ring samples + 32 disc samples whatever the brush size. Score, in colour levels, lower is better: **ring** (RMS difference of the colour averaged in 8 angular sectors, so edges and gradients must match in direction), **texture** (difference in luminance standard deviation between the candidate's disc and the target's ring, so grain matches grain), **clean** (how far the candidate's own average is from its own ring's, which rejects a flat object or spot of its own), and a tiny nearness tie-break. `autoSourceWindow` says which pixels to read, and the search gives the same answer from just that window as from the whole picture. The range is `max(60, 10 reaches)` capped at `MAX_SEARCH_DISTANCE` = 600 px. **Cost** (Node, 24 MP photo): the search is 0.4 to 1.1 ms at brush radii from 4 to 400 px; reading its window is the larger cost and is what the cap bounds (without it a 120 px brush would read 13.7 MP, about 55 MB, for one tap; with it a 30 px brush reads under 2 MP). Tested with 20 new unit tests on hand-checkable scenes (picks plain ground over a blemish, a bright box and texture; the side whose surroundings match; same x on a gradient; avoids a busy neighbourhood to reach clean ground; rejects a flat patch that differs from its surroundings; matches grain to grain; finds an iso-line source on a tilted gradient that only the refinement round reaches; stays on the picture and off the spot; bounded candidates and window; end to end with the heal blend, a blemish on a gradient ends within 1.5 levels of the ramp), and nine deliberate breakages (ring, texture, clean, overlap, bounds, nearness, search growth, range, refinement) were each caught after I added scenes that isolate each term; the first versions of the texture and clean scenes let their breakages through. Honest limits: scored on luminance texture and colour averages only, so it will not recognise structure (a face, text); a tap in a large smooth-then-edge area picks the best of 104 positions, not the global best; there is no "no good source" threshold yet (the score is returned for step 4 to decide).
4. [x] **UI:** the tool is now called **Heal** (it was Clone) and its panel opens with a **Heal | Clone** switch (a radio group; Clone stays the default so nothing existing changes). In Heal mode there is no source to choose: pressing down runs `autoSourceFor` (reads just the search window straight from the photo, so the cost follows the window and not the photo size), paints a heal dab from the source it finds, and dragging carries on with that same source, so a tap fixes a spot and a drag paints a longer blemish; one tap or one drag is one undo step. If nothing suitable is nearby it says "Couldn't find a good place to copy from near here" on the canvas (4 seconds, `role="status"`) and paints nothing. The brush ring shows under the cursor in Heal mode and the "copying from" ring in Clone mode; "Choose a new source" shows only in Clone mode; history entries read "Heal" or "Clone" by the stroke's mode (`healChangeLabel`). New strokes made in Heal mode carry `mode: "heal"`; Clone strokes stay as they were. Tested with 19 new unit tests, net 18 after removing the temporary "heal paints like clone" test (the tap helper, including a full tap end to end on a non-square photo: search, stroke, render, blemish within 1.5 levels of the true gradient; the mode state; the history label) and `e2e/heal.spec.ts` (one tap, one drag, no-source notice, reload, Clone still asks for a source), **written, not yet run in a browser**; five deliberate breakages of the unit-testable parts were each caught (the first run let one through, the dy conversion, and a test now covers it). Limits: the search reads the original photo, not earlier heals, so a second tap over an already-healed area judges the pre-heal pixels; the default mode is still Clone (step 6 decides whether Heal should be the default); keyboard use of the canvas is not supported, as for the other painting tools.
5. [x] **Render and harden:** (a) The core wiring moved up to step 4: `applyStrokes` calls `paintDab`, and the healed-source cache, its append path, undo rebuilds and the Worker all go through it; tested with heal vs clone results, nothing changing outside the dab, a drag of overlapping dabs, the cache's append path equalling a from-scratch paint with mixed modes, and two reads per heal dab. (b) **Hardening, from replaying taps and drags in Node on harder scenes** (a horizon edge, grain, a scratch, a quick swipe, a big brush; the browser was not available, so look at a real photo too): **Gaps on quick swipes (found and fixed, Clone as well as Heal).** The overlay put one dab per pointer report and nothing between, so a swipe with reports far apart left gaps (60 px apart with an 8 px brush: 4 dabs and errors up to 140 levels; interpolated: 91 dabs, 15 at worst). `strokePath.ts` (`dabsAlong`) now lays dabs one every 0.25 radius along the line from the last dab, in real pixels on a wide or tall photo, with float rounding handled and a cap of 200 dabs per report; `addHealStrokes` adds a report's dabs as one state change. **Long blemishes pulled the heal off (found and fixed).** Dragging along a scratch left a mean error of 3.7 levels (worst 6.4) on a plain gradient, against under 1 for a tap, because the unhealed part of the scratch ahead of each dab lies across its measuring ring and fills whole sectors. The ring offsets are now filtered for outliers: pixels more than 2 sigma (and 6 levels) from their sector's average are clipped over 3 rounds, then each sector is replaced by the median of the 9 sectors around it where it differs from that median by more than 6 levels (so smooth variation stays exact, and a real step such as a horizon edge stays sharp). The same scratch drag now has a mean error of 0.25 to 0.7 (worst 0.5 to 1.5); a brush about 1.3 times the blemish's width heals to about 0.3, and a brush smaller than the blemish still cannot (nothing in the ring to measure). **Cost of the filtering:** a heal dab is now roughly 4 times a clone (1.6 ms at radius 30 px, 8 at 60, 21 at 120, 83 at 240, Node, noisy), and on a very steep gradient healed from a flat source (4 levels per pixel, about 100 across the patch) the worst error is 5 levels instead of 2; the auto source normally avoids that case. Tested with 23 new unit tests (the path helper, the sector median, clipping, scratch immunity, a horizon edge not flattened, scratch drags from the end and the middle, a quick swipe with a no-interpolation control that fails as it should) and a browser test for the swipe (written, not yet run); nine deliberate breakages of this code were each caught. **Still to check by eye in a real browser:** seams where overlapping dabs meet on real texture (skin, foliage, sky), whether big brushes (radius 120 px and up, 20 to 80 ms a dab) need coarser spacing, and how Heal feels on a touch screen; if a drag feels slow, spacing is the first thing to try (`SPACING` in `HealOverlay.tsx`, now 0.25 radius).
6. [x] **Tests and profile:** (a) **Default mode decided: Heal.** The tool now opens in Heal (`DEFAULT_HEAL_MODE` in `types/editor.ts`, one constant; pinned by a test). Reason: tapping a spot and seeing it fixed needs nothing explained, whereas Clone needs a source chosen first and reads as nothing happening, and the product brief is "immediately understand what to do". Clone is one click away on the same panel, and a stroke saved without a mode still reads as a clone whatever the default is. It is a judgement made before seeing Heal on a real photo, so flip the constant (and the e2e openers) if it feels wrong. (b) **Profiling stages for `?profile`:** `heal dab (each)` (batch time over dabs in the batch, so it is the per-dab cost), `heal dabs (batch)`, `heal surface (create)` (the full-size copy of the photo the dabs paint on, made once per image and again after an undo), recorded only for batches that actually paint so cache reuse does not water the numbers down, and `heal: find source` around the tap's search. Off, they record nothing. (c) **`e2e/heal.perf.spec.ts`** opens a 12 MP photo with profiling and the main-thread renderer on (the Worker has no `window`, so its stage timings would not reach the harness), does a first tap, a ~33-dab drag and a biggest-brush tap, **prints the numbers** and attaches them to the report, and holds only loose guards (about ten times what a desktop browser should take) plus structural claims: one source per drag, one search per tap, and the drag appends to the cache without rebuilding the surface. **Written, not yet run in a browser: run it, and paste me the `HEAL PROFILE` tables to fill in the real numbers.** (d) The `a11y.spec.ts` axe scan now also covers the Clone-mode panel. (e) 6 new unit tests (the stages recorded and not recorded, empty batches, cache reuse, the per-dab arithmetic, the default). Deliberate breakages: six on this code, five caught, and the sixth is an equivalent mutant (`recordTime` already refuses to record when profiling is off); the first run let the per-dab arithmetic through, and a test now covers it. In Node the dab costs are in step 5 above (1.6 ms at radius 30 px to 83 ms at 240).
7. [~] **Device checks:** (a) **Automated, 15 Nov 2026, written and not yet run:** `npm run e2e:devices` runs `e2e/devices/heal.devices.spec.ts` on three Playwright projects, **webkit** (Desktop Safari: the Safari engine), **iphone** (WebKit with an iPhone 14 screen and touch) and **pixel** (Chromium with a Pixel 7 screen and touch), kept behind `PW_DEVICES` so a plain `npm run e2e` is unchanged and needs no extra browser (`npx playwright install webkit chromium`). Nine tests each: a tap heals and one undo restores it, a drag heals as one undo step, a healed spot survives a reload, Clone mode still works, the no-source notice fits the screen with nothing painted, and a 12 MP photo opens and heals; every test also fails on any page error or `console.error`. On the Pixel profile only (multi-touch needs Chromium's DevTools protocol): a one-finger touch drag, a two-finger pinch that zooms and leaves no stray dab under the first finger, and a stroke already under way being kept when a second finger lands. These are emulations: the right engine, screen size and input type, but not a phone's memory limits, GPU or real fingers. (b) **A bug found by reading the code for this, and fixed:** the first finger of a pinch painted a dab at once (a heal patch in Heal mode), and the second finger then committed it as an undo step, so a staggered two-finger touch left a stray patch under the first finger. Now a second finger landing within 300 ms of the first (`PINCH_GRACE_MS`; fingers do not land at the same instant, and a deliberate stroke runs longer) takes the stroke back with `cancelInteraction`, with no undo step; a longer stroke is kept as before. Pure rule unit-tested (`secondFingerCancels`, including odd clock values keeping the stroke); the behaviour is covered by the pinch tests above. The brush Mask overlay has the same pattern (a second finger "stops painting" but keeps the first dab) and is not changed here. (c) **First run on the device projects (15 Nov 2026): 17 passed, 6 skipped (the Chromium-only multi-touch tests on webkit and iphone, as designed), 4 failed**, and the 17 include the Pixel two-finger pinch test, so the stray-dab fix holds under real multi-touch input. The 4 failures, from two causes: **(i) Ctrl/Cmd+Z did nothing while a native slider had keyboard focus (found and fixed).** The shortcut hook treated every `<input>` as a text field, so after touching the Brush size slider, or any native range slider (the mask area sliders), undo was swallowed until focus moved; a touch tap or touch drag does not move focus off the slider the way a mouse click does, which is why only the touch-driven tests failed (iphone tap, pixel touch drag). It is a keyboard-accessibility bug too: nudge a slider with the arrow keys and Ctrl/Cmd+Z should still undo. `isTextEntry` now counts only fields where text is typed (text-like inputs, textareas, contenteditable); 6 unit tests, seven deliberate breakages caught, and a Chromium browser test that undoes with the brush slider focused. **(ii) The session did not come back after a reload on WebKit (webkit and iphone), cause not yet confirmed.** Saving and restoring swallowed every failure silently ("persistence failures never interrupt editing"), so it showed only as an empty canvas. A strong candidate is a known WebKit limitation: in private browsing, and in the ephemeral contexts Playwright uses, IndexedDB refuses to store a Blob ("Error preparing Blob/File data to be stored in object store") but stores the same bytes. Two changes whatever the cause: failures now log a `[pictoe]` warning (save, load and restore), which the device spec prints and attaches after each test; and a save that fails with the Blob is retried with the photo's bytes (`sessionBlob.ts`: `withBytes`, `photoBlob`; 7 unit tests, breakages caught), with the load accepting either form. If the reload test still fails on webkit, the warning in the output says which step. (d) **Second run on the device projects:** one failure left, in the iphone drag test, and it was not the drag: the behaviour passed, and the test's "no page errors" check caught `Failed to load resource: A TLS error` for the Inter web font, which the app loads from `fonts.googleapis.com` (`__root.tsx`). That is the network in the test environment, and the page is fine without the font (`display=swap`, with a fallback), so the check now ignores failed loads from other sites (a small tested filter) and still fails on any JS error, any other console error, and any failed load from the app's own address. The reload test passed on both webkit and iphone this time, consistent with the Blob-to-bytes fallback having been the cause, though the app's `[pictoe]` warnings are what would confirm it. Side note, not done: loading the font from Google means every visitor's browser contacts Google, and the editor is otherwise local; self-hosting Inter would remove that and the dependency. (e) **Still yours, on a real device:** an iPhone and an Android phone with a real photo (iOS Safari has had a canvas size ceiling of roughly 16.7 megapixels, so try a 12 MP and a 48 MP photo and say what happens), how the brush ring reads with no hover on touch, and whether Heal's patches look right on skin, foliage and sky.

**Status:** built and unit-tested (clone pixel maths, the cached source, the reducer actions, and that strokes land where the user taps for every crop, rotation and flip). **Verified in headless Chromium (27 Oct 2026, 14 scripted checks):** choose a source, paint, the hint and ring, one undo/redo per drag, persistence across a reload, and the healed spot following a 90° rotation and a flip; it also found that the keyboard shortcuts were not wired up (fixed). **Still to check on real devices:** Safari, an iPhone/Android touch screen, and two-finger pinch/pan while the Clone tool is active. **Spot healing (steps 1 to 6, 15 Nov 2026) is built, unit-tested and hardened, with its browser tests written; what remains is running `e2e/heal.spec.ts` and `e2e/heal.perf.spec.ts`, looking at Heal on real photos, and the device checks in step 7 (the automated ones, then a real phone).**

**Closed 24 Nov 2026.** Everything above is built, unit-tested, hardened and covered by browser tests on Chromium, WebKit, an iPhone profile and a Pixel profile (all four device runs green apart from a font-load blip in the test environment, which the checks now ignore). **Three follow-ups remain open because only a person with a real device can do them, none of which blocks M10:** (1) run `npm run e2e -- e2e/heal.perf.spec.ts` and put its `HEAL PROFILE` numbers in step 6 above, the first real in-browser Heal timings; (2) try Heal on real photos (skin, foliage, sky) for visible seams, and confirm Heal as the default mode (`DEFAULT_HEAL_MODE`) or flip it; (3) try an iPhone and an Android phone, especially a 48 MP photo (iOS Safari has had a canvas ceiling of roughly 16.7 MP, which Playwright's WebKit cannot reproduce). Known and not fixed: the brush Mask overlay still keeps the first finger's dab when a pinch starts (Heal and Clone now take it back).

**Decision already made:** manual heal ships *before* any AI heal. It serves a distinct use case, delivers value immediately, and its data model becomes the foundation for the cloud layer in M11.

**Effort:** L

---

### M10 — Workflow & export

**Goal:** make Pictoe useful for more than one photo at a time.

- [ ] **Export resolution scaling** (S/M): percent or long-edge target. This was identified early as a gap and never decided; quality control shipped instead
- [ ] **Filename template** (S), **EXIF / metadata preserve option** (M), **colour profile handling** (M)
- [ ] **Copy / paste edits** between photos (S)
- [ ] **Batch**: apply a preset to many photos, export as a zip (L). Do it **client-side first**; use the Rust service (B5) only if it proves too slow
- [ ] **Preset import / export** (JSON) and **preset thumbnails** (M)
- [ ] **Decide:** should local areas be part of presets and of the history panel? (Today they are in neither: area history is its own stack.)
- [ ] **Multi-image library / filmstrip** (L). Persistence currently holds exactly one photo

---

### M11 — Cloud AI tier *(blocked on decisions)*

**Goal:** the generative and segmentation features that cannot run locally.

Planned capabilities (all already **recognised and honestly labelled as unavailable** in the Intent Bar):

- [ ] Object removal / magic eraser
- [ ] Generative expansion
- [ ] Sky replacement and background replacement
- [ ] Subject isolation (segmentation), which can also **auto-generate masks** feeding the M8 mask system
- [ ] AI-assisted heal (builds on M9's `HealStroke`)
- [ ] LLM-backed intent interpretation: translate free-form requests into the same *suggest → preview → approve* patch contract. The AI **suggests, the user approves**; nothing is applied silently

**Prerequisites that do not exist yet** (this is new architecture, not a UI task):

| Need | Today |
|---|---|
| Backend / API layer | None yet. `server.ts` and `start.ts` are SSR entry points only. Planned as a **Rust service**: see Backend track B0–B4 |
| Provider choice and cost model | Undecided |
| API-key custody | Held by the Rust gateway (B3); never in the client bundle |
| Privacy copy and consent | Needed the first time an image leaves the device |
| Online/offline UI states | Partly stubbed; "your current edits remain safe" copy already exists |
| Failure behaviour | Must never lose or corrupt local edits |

**Effort:** L, and larger than any milestone so far.

---

### M12 — Ship

- [ ] **Hosting decision.** The build already targets Cloudflare via the Nitro `cloudflare-module` preset (`npx nitro deploy --prebuilt`), but no deployment has been confirmed. The Rust service needs its own hosting decision (B0), and the editor will then call it cross-origin, so CORS and a short-lived token matter
- [ ] Custom domain, production error monitoring
- [ ] PWA / installable, offline-after-first-load (note: Inter currently loads from Google Fonts; self-host it for true offline)
- [ ] Privacy-friendly analytics decision (see PRD success metrics: none are instrumented today)
- [ ] Landing page / docs, licence confirmation

---

### Backend track — Rust service *(runs in parallel with M7–M12)*

**Principle.** Everything shipped so far runs in the browser and stays that way. The backend exists for capabilities that **cannot** run locally (M11) plus optional heavy jobs. It is **opt-in per operation**: editing, undo, presets and export never depend on it.

**What Rust does and doesn't buy you**
- For AI features the service is mostly a **gateway** to a model provider. Latency is dominated by the model and the network, not the language, so Rust won't make those features faster.
- Rust's real wins: low memory per in-flight job, safe concurrency, predictable latency under load, one small static binary.
- Rust matters most for **image work itself**: server-side resize/encode, batch export, mask post-processing, or running the client engine as WASM (see below).
- Cost: slower to iterate than TypeScript for a solo developer, and the repo already has a TS server layer (TanStack Start / Nitro). **B0 was a spike so this is decided with evidence, not assumption; the decision is recorded below.**

**Decision (B0 closed, 27 Oct 2026): build the gateway in Rust.**
- **Why:** Pictoe is also a portfolio piece, and a Rust service behind a clean job API is a stronger thing to show than a proxy in the same language as the front end. The spike also showed the stack is comfortable here: 23 tests pass, a 2.1 MB release binary, under 6 MB of RAM after 12,800 requests, and p99 of 6.8 ms in a local load test. That load test says the service is not slow, not that Rust is faster for the product.
- **Cost accepted:** slower iteration than TypeScript, a second toolchain and deployment, and types that must be generated rather than shared. A thin TS gateway would have been faster to ship; this is a deliberate trade.
- **Mitigations:** keep the API surface small (the spike's job API is the contract); generate TypeScript types from OpenAPI in B2 so the two sides can't drift; keep the editor independent of the service.
- **Revisit trigger:** if B3's first end-to-end operation stalls, fall back to a thin TS gateway. The job API is language-neutral, so the editor-side client would not change.

**Proposed stack (adjust freely):** `axum` + `tokio` · `tower-http` (CORS, tracing, timeouts, body limits) · `serde` · `reqwest` (provider calls) · `utoipa` (OpenAPI) · `tracing` · `tower_governor` (rate limits) · S3-compatible object storage · `sqlx` + Postgres only if jobs/quotas need persistence · `image` / `fast_image_resize` for server-side image ops.

| ID | Stage | Scope | Effort |
|---|---|---|---|
| **B0** | ✅ **Decide & spike** *(decided: Rust; hosting still open)* | Choose hosting: a long-running container (Fly, Railway, VPS) vs Cloudflare Workers via `workers-rs`. Verify Workers' CPU/time limits before choosing it for image jobs. Build `/health` plus one provider-proxy endpoint, called from the editor. Compare against a thin TS gateway. Record go/no-go | M |
| **B1** | ✅ **Skeleton** | axum app, env config, structured logs, JSON error type, CORS allowlist, request-size limit, graceful shutdown, Dockerfile, CI (`fmt`, `clippy`, `test`, build) | M |
| **B2** | **API contract** | OpenAPI spec; **generate TypeScript types for the editor** so Rust and TS can't drift. Job model: `POST /jobs` → `202 {id}`, `GET /jobs/:id`, `DELETE /jobs/:id` (cancel). Map error codes to the existing human-readable copy. **Decide how cloud results stay non-destructive** (see below) | M |
| **B3** | **AI gateway** | Provider adapter trait (swap providers without touching routes). Keys held server-side only. Timeouts, retry with backoff, cancellation. Per-IP / per-token rate limits and a daily spend cap. Ship one operation end to end. *Suggestion:* start with **subject segmentation → mask**, because it is non-generative and feeds the M8 mask system | L |
| **B4** | **Data handling & trust** | Process in memory or short-lived storage; delete on completion or TTL (*proposed:* ≤ 1 h); never log image content; content-type sniffing and dimension limits; signed short-lived URLs if storage is used; decide EXIF handling; privacy copy and consent UI | M |
| **B5** | **Server-side image ops** *(only if needed)* | Batch export/resize, format conversion (e.g. HEIC/AVIF decode for FR-04), thumbnails | M–L |
| **B6** | **Operations** | Deploy, staging env, health checks, metrics and alerts, cost dashboard, load test, secret rotation, `cargo audit` / `cargo deny` | M |

**Status (B0 spike built):** `backend/` contains a working service: `GET /health`, `POST/GET/DELETE /jobs`, strict JSON validation, CORS allowlist, request-size limit and timeout, active-job cap, finished-job expiry, real cancellation, graceful shutdown, and a uniform human-readable error shape. It has 23 tests and was also run as a real release binary. It has **no AI and no fake results**: cloud-only operations return an honest `501`. **B1 is done:** backend CI (fmt, clippy with warnings as errors, tests); expected `501`/`503` refusals log as warnings, not errors; and a Dockerfile (two-stage build, distroless runtime, non-root, self health check, graceful `SIGTERM`) that the backend CI builds and smoke-tests on every change. The Dockerfile was verified here against stand-in base images (no registry access); the first CI run built it against the real ones and passed (confirmed 3 Nov 2026). Still open: where to host it. **B2 progress:** the contract is generated from the Rust types: `backend/openapi.json` (served live at `GET /openapi.json`), then `src/api/schema.d.ts` for the editor (`npm run api:types`). Rust tests fail if the committed spec is stale or if the service answers with a status, error code or header the spec doesn't document; CI fails if the generated types are stale; the editor's error copy and Intent Bar rules are compile- and test-checked against the spec. **B2 remaining:** the non-destructive-results decision (below). **B0 go/no-go: go, with Rust** (decision above). The spike shows Rust is comfortable here, not that it is faster for the product (see `backend/README.md`).

**Editor-side integration**
- [ ] `src/engine/cloud/` client using the generated types; a `useCloudJob` hook with states `idle → uploading → processing → ready | failed | cancelled`
- [ ] Connectivity: browser online state plus a health ping. Disable cloud-only actions with the existing *"your current edits remain safe"* copy
- [ ] **Consent dialog** before the first upload, stating exactly what is sent
- [ ] **Non-destructive results.** Cloud output must never overwrite the source. Store it as a referenced asset inside the edit model (a derived layer, or a returned mask), so undo, reset and the original all keep working. This changes the `EditState` shape and what session persistence stores, so settle it in B2
- [ ] Progress, cancel and retry; a failed job never touches local edits
- [ ] Intent Bar: route the cloud-only intents it already detects into the job flow instead of the "unavailable" card

**Security checklist (proposed)**
Keys server-side only · CORS allowlist · rate limits and spend cap · body-size limits · no image content in logs · short retention · dependency auditing · a plan for abuse when there are no user accounts (open question 8).

**Optional: Rust in the browser (WASM)**
Port the heaviest pixel loops (sharpen, colour-band saturation, mask compositing) to a Rust crate compiled with `wasm-bindgen`, running in a Worker. The GPU-friendly CSS-filter stage stays as is. **Gate:** only do this if M7 profiling shows the pixel loops dominate, and benchmark it against WebGL/WebGPU first. Effort: L. It is independent of the service above.

**Dependencies:** B0–B2 can start any time after 6.5. B3 must land before M11. B5 is optional. WASM follows M7 profiling.

---

## 5. Sequencing

```
        ┌──────────────────────────────────────────────────────────┐
  NOW   │ 6.5 Stabilise  (README · Heal reconcile · tests · config)  │
        └───────────────────────────┬──────────────────────────────┘
                                    ▼
  DONE    M7 Quality & reach  ──▶  M8 Local editing depth  ──▶  M9 Heal (local)
                                    │                              │
                                    └──────────────┬───────────────┘
                                                   ▼
  NOW                              M10 Workflow & export
                                                   ▼
                          M11 Cloud AI  (needs backend + provider + privacy decisions)
                                                   ▼
                                           M12 Ship
```

**Backend track placement.** B0 (spike) and B1–B2 can run alongside M7–M8. B3 (AI gateway) is the gate for M11. B5 is optional and only if profiling or batch needs justify it.

**Why this order**
- **Tests before depth.** M8 refactors the render pipeline; tests make that safe.
- **Worker/WebGL work (M7) before tonal accuracy and curves (M8)**, which would otherwise be built twice.
- **Mask cache (6.5) before new mask shapes (M8)**, since gradient and radial masks multiply rasterisation cost.
- **M9 before M11:** the manual heal data model is the base for AI heal.
- **M11 produces masks that M8 consumes:** segmentation output should land in the same mask-layer structure.
- **M12 can start earlier** if you want a public deployment sooner. Nothing in M7–M10 blocks it.

---

## 6. Decisions already made (so they aren't re-litigated)

| Decision | Why |
|---|---|
| Per-colour-band saturation is **six extra keys in the existing `Adjustments` record** | Reuses the slider, basic/advanced disclosure, undo, presets and session persistence with no new UI path |
| Masks are **resolution-independent brush strokes**, normalised to the output frame and rasterised at render time | A mask painted on a small preview lines up at full export resolution |
| Local layers expose only **exposure, contrast, saturation, temperature** | They map directly onto the existing CSS-filter pipeline (no new pixel maths) |
| Presets live in their **own IndexedDB database** (`pictoe-presets`), separate from the session (`pictoe`) | Avoids touching the already-verified session store's versioning |
| **Local-first.** Cloud features are labelled unavailable rather than simulated | Honest UI; no fake results |
| **Manual heal before AI heal**, sharing one data model | Immediate value; no blocking on cloud infrastructure |
| Export quality is **preset + custom slider**, not resolution scaling | Chosen explicitly; scaling stays an open item (M10) |
| Applying a preset is a **full replace onto neutral defaults** | A preset is a complete look, not a nudge from wherever sliders currently sit |
| Mask undo/redo is a **separate stack** scoped to the Local tool | Keeps global history snapshots small and fast |
| **Backend language: Rust** (axum/tokio), decided 27 Oct 2026 after the B0 spike | Chosen for portfolio value and safe concurrency, accepting slower iteration than a thin TS gateway; revisit if B3 stalls |
| **Backend is opt-in per operation** | Preserves the local-first promise; editing never requires a network |
| **Cloud results are stored as referenced assets, never over the source** | Keeps the original immutable and undo/reset working |

---

## 7. Open questions for you

1. **Heal:** build the local clone-stamp now (M9), or leave the tool as the cloud placeholder? And does unpushed Heal work already exist anywhere?
2. **Cloud AI:** is it a near-term goal at all? If yes, which provider and what budget? This gates all of M11.
3. **Hosting:** Cloudflare (as the build is configured), or something else?
4. **Lovable:** stay connected, or detach?
5. **Areas in presets / history:** should a preset include local areas? Should the history panel list area edits?
6. **Platform priority:** still desktop-first, or is mobile/Safari support a launch requirement (which would pull the M7 browser work forward)?
7. **Backend hosting:** a container platform (Fly/Railway/VPS) or Cloudflare Workers via `workers-rs`? Workers has CPU/time limits that may not suit image jobs.
8. **Abuse and cost control without accounts:** is a signed anonymous token plus rate limits and a spend cap enough, or do cloud features need a minimal sign-in? (The PRD currently lists accounts as a non-goal.)
9. **First cloud operation:** subject segmentation → mask (feeds local editing, non-generative) or a generative feature such as object removal?
10. **Rust in the browser:** worth a WASM engine, or is a Worker plus WebGL enough? Decide after M7 profiling.

---

## 8. Explicitly out of scope

Carried over from the original product brief and still true:

Social feed · user profiles · community · template marketplace · collaboration · cloud galleries · complex account systems · an AI **chat** assistant · generative image creation from scratch · a full RAW development pipeline · native mobile apps.

> **Product rule that governs every item above:** *Does this help the user achieve their intended result with less friction while preserving control?* If not, it doesn't ship.
