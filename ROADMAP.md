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
| ESLint | ✅ 0 errors, 7 warnings (all `react-refresh/only-export-components`) |
| Automated tests | 🟡 96 unit tests (Vitest): history, local areas, intent parser, mask cache, mask coordinates, renderer brush placement. No UI or end-to-end tests yet |
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
| 2 | **Reconcile the Heal tool** | `main` has no Heal implementation. The tool is a placeholder panel saying "runs on the cloud engine". If any manual clone-stamp work exists in a local or unpushed session, it needs to be found and reconciled before more work touches `Canvas.tsx`, `CropOverlay.tsx` or the edit model | S |
| 3 | ✅ **Masks follow crop, rotation and flip** | Strokes are now stored relative to the *source image* and converted to the visible frame at draw time. Older saved sessions are converted when loaded. Unit-tested against the renderer's own canvas transform. **Still to confirm by eye in a browser** | ✅ |
| 4 | ✅ **Mask rendering cache** | One rasterised mask per layer; painting draws only the new stroke (300 stroke-draws instead of about 45,000 over a 300-stroke session); exports skip the cache | ✅ |
| 5 | **Config hygiene** | **Correction:** the `vite-tsconfig-paths` plugin cannot simply be removed. It is a required peer dependency of `@lovable.dev/vite-tanstack-config`, and the repo's `vite.config.ts` does not add it itself. The dev-server warning stays until that wrapper is upgraded or replaced (see item 6). Package renamed `tanstack_start_ts` → `pictoe` ✅. Fix or consciously accept the 7 lint warnings | S |
| 6 | **Decide on Lovable coupling** | `AGENTS.md` and `.lovable/` still tie the repo to Lovable (and warn against rewriting pushed history). `reportLovableError` is a no-op outside the Lovable editor preview. Decide whether to stay connected or detach cleanly | S |
| 7 | ✅ **First automated tests** | Vitest with 96 tests; more to add in M7 | ✅ |

---

## 4. Upcoming milestones

### M7 — Quality & reach *(hardening)*

**Goal:** make what exists trustworthy on more devices and for more people.

- [ ] **Test suite + CI** (M). Started: 96 unit tests already cover reducer history and local areas, the intent parser, the mask cache, mask coordinates and renderer brush placement. Remaining targets, in priority order:
  - Reducer: `undo` / `redo` / `jumpTo`, mask history, `closeImage`, `restoreSession`
  - `parseIntent` (rules, intensity words, cloud-only detection) and `analysisSuggestion` thresholds
  - `analyzeImage` against synthetic dark / bright / warm / cool images
  - History label diffing (`summarizeChange`)
  - A render smoke test (known input → expected pixel ranges)
  - Playwright e2e: import → edit → undo → export → reload → restored
- [ ] **Cross-browser verification** (M). **Found:** Safari and iOS Safari ship canvas `ctx.filter` disabled by default (caniuse: Safari 18.0 through 26.x), so every filter-based adjustment would have silently done nothing there. **Done:** feature detection plus a pixel-maths fallback (`canvasFilter.ts`), unit-tested against the CSS filter formulas. **Still to do:** try it on real Safari and iOS devices; check WebP export (Safari may not encode WebP from a canvas and may return PNG instead); check session restore and touch behaviour
- [x] **Touch gestures** (M). Pinch-to-zoom and two-finger pan are built for every tool with unit-tested gesture maths, and a second finger no longer paints in the Local tool. **Still to do:** try on a real phone or tablet. Known quirk: a tiny dab can appear under the first finger when a pinch starts in the Local tool (mask undo removes it)
- [ ] **Move heavy pixel work off the main thread** (L). Sharpening, colour-band saturation and mask compositing all loop over pixels synchronously. Options: `OffscreenCanvas` + Worker, WebGL/WebGPU, or Rust compiled to WASM in a Worker (see Backend track)
- [ ] **Large-image guardrails** (S). Max decode size, memory-safe export path, clear message instead of a crash on very large files
- [ ] **Accessibility pass** (M). Mask painting is pointer-only. Provide a keyboard alternative or an honest note. Audit focus order, contrast, `prefers-reduced-motion`

**Done when:** CI runs `tsc` + lint + tests on every push; the core flow is covered end to end; the app is confirmed working (or gracefully degraded) on Safari, Chrome and Firefox.

---

### M8 — Local editing depth *(the "pro" milestone)*

**Goal:** close the biggest remaining gap between Pictoe and a serious editor.

- [ ] **More mask shapes** (L): linear gradient and radial masks alongside the brush
- [ ] **Mask management** (M): rename, duplicate, reorder, invert, show/hide toggle, thumbnails
- [ ] **More per-area parameters** (M): highlights, shadows, clarity, sharpness, tint (today: exposure, contrast, saturation, temperature)
- [ ] **Full HSL** (M): hue and luminance per colour band (saturation per band already ships)
- [ ] **Curves** (L): RGB + luminance, point editor, keyboard-accessible
- [ ] **Colour grading** (M): shadows / mids / highlights wheels
- [ ] **Tonal accuracy** (L): highlights, shadows, whites and blacks currently use flat blend-mode layers as an approximation. Replace with true luminosity-masked adjustments (best done together with the worker/WebGL work in M7)

**Done when:** a user can brighten a face with a radial mask, cool a sky with a gradient, and fine-tune greens with hue/saturation/luminance, all non-destructively and all surviving a reload.

---

### M9 — Heal *(local first)*

**Goal:** spot healing and clone-stamp without needing a network.

- [ ] Add a `HealStroke` type to the **non-destructive edit model** (source offset, radius, softness) so strokes are data, not baked pixels
- [ ] Render pass: clone from a **snapshot taken before the write** (prevents self-copy artefacts)
- [ ] Tap-to-set-source, drag-to-paint overlay (reuse the zoom/pan-aware coordinate mapping from `CropOverlay` / `MaskOverlay`)
- [ ] Bundle a whole drag into a single undo step
- [ ] Persist heal strokes with the session

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
- Cost: slower to iterate than TypeScript for a solo developer, and the repo already has a TS server layer (TanStack Start / Nitro). **B0 is a spike so this is decided with evidence, not assumption.**

**Proposed stack (adjust freely):** `axum` + `tokio` · `tower-http` (CORS, tracing, timeouts, body limits) · `serde` · `reqwest` (provider calls) · `utoipa` (OpenAPI) · `tracing` · `tower_governor` (rate limits) · S3-compatible object storage · `sqlx` + Postgres only if jobs/quotas need persistence · `image` / `fast_image_resize` for server-side image ops.

| ID | Stage | Scope | Effort |
|---|---|---|---|
| **B0** | **Decide & spike** | Choose hosting: a long-running container (Fly, Railway, VPS) vs Cloudflare Workers via `workers-rs`. Verify Workers' CPU/time limits before choosing it for image jobs. Build `/health` plus one provider-proxy endpoint, called from the editor. Compare against a thin TS gateway. Record go/no-go | M |
| **B1** | **Skeleton** | axum app, env config, structured logs, JSON error type, CORS allowlist, request-size limit, graceful shutdown, Dockerfile, CI (`fmt`, `clippy`, `test`, build) | M |
| **B2** | **API contract** | OpenAPI spec; **generate TypeScript types for the editor** so Rust and TS can't drift. Job model: `POST /jobs` → `202 {id}`, `GET /jobs/:id`, `DELETE /jobs/:id` (cancel). Map error codes to the existing human-readable copy. **Decide how cloud results stay non-destructive** (see below) | M |
| **B3** | **AI gateway** | Provider adapter trait (swap providers without touching routes). Keys held server-side only. Timeouts, retry with backoff, cancellation. Per-IP / per-token rate limits and a daily spend cap. Ship one operation end to end. *Suggestion:* start with **subject segmentation → mask**, because it is non-generative and feeds the M8 mask system | L |
| **B4** | **Data handling & trust** | Process in memory or short-lived storage; delete on completion or TTL (*proposed:* ≤ 1 h); never log image content; content-type sniffing and dimension limits; signed short-lived URLs if storage is used; decide EXIF handling; privacy copy and consent UI | M |
| **B5** | **Server-side image ops** *(only if needed)* | Batch export/resize, format conversion (e.g. HEIC/AVIF decode for FR-04), thumbnails | M–L |
| **B6** | **Operations** | Deploy, staging env, health checks, metrics and alerts, cost dashboard, load test, secret rotation, `cargo audit` / `cargo deny` | M |

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
  NEXT    M7 Quality & reach  ──▶  M8 Local editing depth  ──▶  M9 Heal (local)
                                    │                              │
                                    └──────────────┬───────────────┘
                                                   ▼
  LATER                            M10 Workflow & export
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
| **Backend language: Rust** (axum/tokio), validated by a B0 spike before full commitment | Chosen for safe concurrency and low overhead; the spike checks it against a thin TS gateway |
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
