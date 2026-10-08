# Pictoe — Product Requirements Document

| | |
|---|---|
| **Version** | 1.0 |
| **Date** | 7 October 2026 |
| **Owner** | Adnan Ansari |
| **Status** | Living document. Reflects `main` @ `d140ea3` |
| **Related** | [ROADMAP.md](./ROADMAP.md) · [README.md](./README.md) |

> **How to read this document.** Status columns describe what is in the repository today (verified by type-check, build and code inspection; the newest local-mask commits were not exercised in a browser). Targets marked *proposed* are suggestions: nothing in the product is instrumented, so none of them has been measured. User descriptions in §3 are hypotheses drawn from the original product brief, not research findings.

---

## 1. Summary

**Pictoe is an adaptive, canvas-first image editor that gives people professional creative control without making them learn a professional tool first.**

A beginner can improve a photo in seconds. An experienced user can reach precise, local, non-destructive controls without leaving the same workspace. An intent interface lets users say what they want ("make it warmer", "add drama"); Pictoe **proposes** a specific adjustment, shows it live, and the user decides.

> **Your image. Your intent. Your control.**

---

## 2. Problem

- **Professional editors are powerful but intimidating.** Dense panels and unfamiliar vocabulary stand between a new user and a good result.
- **Simple editors and one-tap filters are approachable but shallow.** They hide the controls that matter once someone wants to go further.
- **AI-first editors often take the decision away from the user,** replacing the result rather than assisting the process.

Users are forced to choose between **power** and **approachability**, and between **assistance** and **authority** over their own image. Pictoe's position is that these do not have to be trade-offs.

*(This framing is product positioning. It has not been validated with user research.)*

---

## 3. Target users *(hypotheses)*

| Persona | Wants | Fears |
|---|---|---|
| **The newcomer** | A noticeably better photo in seconds | Sliders and jargon; breaking something |
| **The enthusiast** | Real control, without an enterprise UI | Losing the original; being locked into one look |
| **The pro-curious / pro** | Precision, local adjustments, repeatability, speed | Tools that hide or approximate controls |

Primary context today is **desktop/laptop**, with a deliberately separate mobile composition.

---

## 4. Product principles

1. **The image is the protagonist.** The interface recedes while the user works.
2. **Progressive power.** Complexity is *revealed*, never removed. The engine is the same for beginner and pro; only the visible surface changes.
3. **User control.** AI **suggests**; the user **approves**. Nothing is applied silently.
4. **Non-destructive by construction.** The original is never modified. Edits are structured state applied at render and export time.
5. **Local-first and honest.** Editing runs in the browser. Anything needing the cloud is labelled as such, never simulated.
6. **Calm and fast.** Subtle 150–250 ms transitions; motion communicates state, never decorates.
7. **Responsive by composition,** not by shrinking the desktop layout.
8. **Feature discipline.** *Does this help the user reach their intended result with less friction while preserving control?* If not, it doesn't ship.

---

## 5. Goals and non-goals

### Goals
- **G1.** A first-time user makes a visible improvement quickly (*proposed:* within about 30 seconds of import).
- **G2.** A professional can reach precise and local controls without leaving the workspace.
- **G3.** Edits never destroy the original, and a user can always get back.
- **G4.** All image processing works without a network connection.
- **G5.** The user can always see, change or reject what the assistant proposes.

### Non-goals (v1)
User accounts · social features · collaboration · cloud galleries · template marketplace · an AI *chat* assistant · generative image creation from scratch · a full RAW pipeline · native mobile apps.

---

## 6. Functional requirements

**Priority:** P0 must-have · P1 important · P2 later.
**Status:** ✅ Shipped · 🟡 Partial · ⬜ Planned · ❌ Not built · ⚠️ Open issue

### A. Import & workspace
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-01 | Import JPG, PNG, WebP via picker or drag-and-drop, with human-readable errors | P0 | ✅ |
| FR-02 | Empty state shows no editing controls; empty and editing states are separate | P0 | ✅ |
| FR-03 | Visible loading state during import; no double-submit | P1 | ✅ |
| FR-04 | Additional formats (HEIC, AVIF, TIFF, RAW) | P2 | ⬜ |

### B. Canvas
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-10 | Fit-to-screen, cursor-centred wheel zoom, drag pan, reset | P0 | ✅ |
| FR-11 | Pinch-to-zoom and two-finger pan on touch devices | P1 | ❌ |
| FR-12 | Responsive composition: docked panel on desktop, bottom sheet on mobile | P0 | ✅ |

### C. Global editing
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-20 | 14 non-destructive adjustments, each with slider, numeric value and reset: **Light** (exposure, brightness, contrast, highlights, shadows, whites, blacks) · **Color** (saturation, vibrance, temperature, tint) · **Detail** (clarity, sharpness, blur) | P0 | ✅ |
| FR-21 | Basic / advanced disclosure within each group | P0 | ✅ |
| FR-22 | Per-colour-band saturation (red, orange, yellow, green, blue, purple) | P1 | ✅ |
| FR-23 | Hue and luminance per band, Curves, colour grading | P2 | ⬜ |
| FR-24 | Luminosity-accurate highlights / shadows / whites / blacks (today: blend-layer approximation) | P2 | ⬜ |
| FR-25 | Crop with aspect presets, 90° rotation, horizontal flip | P0 | ✅ |

### D. Local editing
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-30 | Brush-painted areas, multiple layers, each with exposure, contrast, saturation, temperature | P1 | ✅ |
| FR-31 | Eraser, adjustable brush size and softness | P1 | ✅ |
| FR-32 | Area undo/redo (scoped to the Local tool) and persistence across sessions | P1 | ✅ |
| FR-33 | Gradient and radial masks; invert, duplicate, reorder, rename, show/hide | P2 | ⬜ |
| FR-34 | Masks remain correctly placed if the crop changes afterwards | P1 | ✅ Strokes are stored relative to the source image (unit-tested; confirm by eye) |
| FR-35 | More per-area parameters (highlights, shadows, clarity, sharpness, tint) | P2 | ⬜ |

### E. History
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-40 | Undo / redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z) without reloading state | P0 | ✅ |
| FR-41 | History panel: every past/future state with a plain-language label; jump to any state | P1 | ✅ |
| FR-42 | Reset a single adjustment or everything | P0 | ✅ |

### F. Compare
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-50 | Hold to see the original; accessible toggle for users who can't use the gesture | P0 | ✅ |

### G. Intent & assistance
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-60 | Intent Bar turns plain language into a **suggested** adjustment patch; never auto-applies | P0 | ✅ Rule-based |
| FR-61 | **Live preview** before Apply; Dismiss restores exactly; Apply is one undo step | P0 | ✅ |
| FR-62 | Suggestion strength scales to the actual image; proactive suggestion on an unedited, genuinely dark/bright photo | P1 | ✅ |
| FR-63 | Cloud-only requests (object removal, expansion, sky/background replacement, subject isolation) are recognised and clearly labelled as needing a connection | P0 | ✅ |
| FR-64 | LLM-backed interpretation of free-form intent (same suggest → preview → approve contract) | P2 | ⬜ |
| FR-65 | Intents that create local areas ("brighten the sky"), dependent on segmentation | P2 | ⬜ |

### H. Presets
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-70 | Built-in presets (Warm Film, Moody B&W, Vivid Pop, Cool Blue, Soft Portrait), applied as a full replace | P1 | ✅ |
| FR-71 | Save and delete personal presets, stored locally | P1 | ✅ |
| FR-72 | Preset import/export and thumbnails; decide whether presets include local areas | P2 | ⬜ |

### I. Persistence
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-80 | Restore the last image, its edits and its local areas after reload; closing an image explicitly clears the saved session; persistence failure never interrupts editing | P1 | ✅ |
| FR-81 | Multi-image library / filmstrip | P2 | ⬜ |

### J. Export
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-90 | Export JPG, PNG, WebP with quality presets (High / Medium / Small) and a custom 1–100% slider (JPG/WebP) | P0 | ✅ |
| FR-91 | Original never modified; local areas included in the exported image | P0 | ✅ |
| FR-92 | Resolution scaling, filename template, metadata/EXIF option, colour-profile handling | P2 | ⬜ |
| FR-93 | Batch apply and batch export | P2 | ⬜ |

### K. Heal & cloud
| ID | Requirement | P | Status |
|---|---|---|---|
| FR-100 | Local spot-heal / clone-stamp, stored as non-destructive strokes | P2 | ❌ Placeholder panel only |
| FR-101 | Object removal, generative expansion, sky/background replacement, subject isolation, AI-assisted heal | P2 | ⬜ Needs the planned Rust service (ROADMAP: Backend track) |

---

## 7. Non-functional requirements

### Performance *(proposed targets; none measured)*
- Slider drags feel immediate on a typical 12 MP photo on a mid-range laptop (*proposed:* ≥ 30 fps preview).
- Interactive preview is **downscaled to what the viewport can show**; full resolution is used only at export (already the design).
- Export of a ~24 MP photo completes in a few seconds (*proposed:* under 5 s).
- **Known pressure points:** sharpening, colour-band saturation and mask compositing are synchronous main-thread pixel loops. Mask rasterisation is now cached per layer. See the roadmap (M7).

### Privacy
- **Image data is never uploaded.** There are no accounts.
- The only outbound request found in the source is **Google Fonts (Inter)**.
- The Lovable error-reporting hook is a no-op outside the Lovable editor preview.
- When cloud features arrive, the UI must make the online state explicit and obtain consent **before** an image leaves the device.
- *Proposed backend rules:* images are processed in memory or short-lived storage and deleted on completion or after a short TTL (about an hour); image content is never logged; provider keys never reach the client; requests are rate-limited with a spend cap.

### Reliability
- Persistence failures (private browsing, storage quota) are swallowed so they never interrupt editing.
- Errors are human-readable (see §8); edits are never silently discarded.

### Accessibility
- Required: keyboard navigation, visible focus, ARIA labels, accessible slider values, sufficient contrast, reduced-motion support, a non-gesture alternative for before/after.
- **Known gap:** local-area painting is pointer-only.

### Compatibility
- Target: current evergreen desktop browsers; tablet and mobile compositions exist.
- **Risk:** the render pipeline uses Canvas `ctx.filter` for exposure, contrast, saturation and blur. Support has varied across browsers (notably Safari/iOS). **Cross-browser verification has not been done.**

---

## 8. UX requirements

- **Layout.** Header (back, filename, undo, redo, history, export) · canvas · contextual panel · tool dock. No permanent inspector; controls appear when a tool is active and collapse when it isn't.
- **Tool dock (current order).** Adjust · Color · Detail · Crop · Local · Heal · Intent · Presets.
- **Panel behaviour.** Desktop: a docked 360 px right-hand column. Mobile: a bottom sheet.
- **Progressive disclosure.** Basic sliders first, "More controls" for advanced ones; the same engine underneath.
- **Motion.** 150–250 ms, smooth easing, no bounce; panels emerge softly; before/after is instant.
- **Error and offline copy.** Plain language, never technical. Examples already in the product:
  - *"Pictoe couldn't process this image. Try another image or check its format."*
  - *"…runs online and isn't available yet. Your current edits remain safe."*
- **Honesty rule.** If a capability isn't available, say so; never fake a result.

---

## 9. Technical architecture *(summary)*

```
UI components
     ↓
EditorContext  (reducer: edit state · history · masks · viewport · session)
     ↓
Engine  (pure; no React)
  ├─ image/load.ts      decode, validate
  ├─ image/render.ts    one pipeline for preview AND export
  ├─ image/analyze.ts   client-side statistics
  └─ storage/           IndexedDB: session, presets
```

**Rendering pipeline order:** transform (crop/rotate/flip) + CSS-filter adjustments → tone layers → colour-band saturation → sharpen → local areas (each stacked on everything above).

**Planned cloud tier.** An optional **Rust (axum) service** behind a job-based API (`POST /jobs`, `GET /jobs/:id`, cancel), with provider keys held server-side. It is **opt-in per operation**; local editing, undo and export never depend on it. Cloud results are stored as referenced assets in the edit model, never over the source image. See ROADMAP: Backend track B0–B6.

**Constraints**
- The original image is immutable; the same pipeline renders preview and export so *what you see is what you get*.
- Edits are structured data (`EditState`: adjustments, crop, rotation, flip). Local areas are resolution-independent brush strokes, rasterised at render time.
- No image-processing logic in UI components.
- Cloud features must plug in behind the existing *suggest → preview → approve* contract.

**Stack:** React 19 · TypeScript · Vite 8 · TanStack Router/Start · Tailwind CSS 4 · Radix UI · lucide-react · React Query · Zod. Build targets Cloudflare via Nitro (`cloudflare-module`).

---

## 10. Success metrics *(proposed; no instrumentation exists)*

| Metric | What it tells us |
|---|---|
| Time from import to first edit | Is the entry experience clear? |
| % of sessions that reach export | Do people finish what they start? |
| Session-restore success rate | Does persistence actually work for real files? |
| Intent suggestions applied vs dismissed | Are the suggestions useful? |
| Undo/history usage | Are users experimenting with confidence? |
| Crash-free sessions | Reliability |

Collecting any of these requires a deliberate, privacy-respecting analytics decision (ROADMAP M12). Until then, treat them as targets to design toward.

---

## 11. Release plan

See [ROADMAP.md](./ROADMAP.md) for sequencing, effort and dependencies.

| Release | Content |
|---|---|
| **Shipped** | Milestones 1–5 plus most of 6: workspace, 14 adjustments, crop, history, intent with preview, local analysis, presets, persistence, colour bands, local areas |
| **Next** | 6.5 Stabilise → M7 Quality & reach |
| **Then** | M8 Local depth → M9 Local heal → M10 Workflow & export |
| **Gated** | M11 Cloud AI (needs the Rust service, Backend track B0–B4, plus provider and privacy decisions) |
| **Anytime** | M12 Ship (hosting, PWA, docs) |

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Canvas `ctx.filter` support varies by browser | Adjustments could silently do nothing | Cross-browser test early (M7); add a fallback path if needed |
| Main-thread pixel loops and per-render mask re-rasterisation | Sluggish editing on large photos | Mask caching (done); Worker / WebGL (M7) |
| Masks misalign after a crop change | Wrong region edited | Fixed: strokes are stored in source space (unit-tested); confirm by eye |
| Tonal controls are an approximation | Weakens the "pro" claim | Luminosity-masked rewrite (M8) |
| Limited automated tests | UI and renderer-output regressions found only by hand | 62 unit tests exist; extend to render and end-to-end checks and add CI (M7) |
| Cloud AI: cost, key custody, privacy | Security and trust exposure | Server-side keys only; explicit consent; decide provider before building (M11) |
| Scope creep | Dilutes the product | The feature-discipline rule in §4 |
| Rust backend slows a solo developer | Cloud work stalls | B0 spike compared with a thin TS gateway before committing |
| Abuse and cost with no user accounts | Unbounded spend | Rate limits, spend cap, signed anonymous tokens; decide on minimal sign-in |
| Rust and TypeScript types drift apart | Runtime errors at the API boundary | Generate TS types from the OpenAPI spec |
| Lovable coupling | History-rewrite hazards; unclear ownership of the sync | Decide whether to detach (M6.5) |

---

## 13. Open questions

1. Should local areas be part of presets and of the history panel?
2. Is cloud AI a near-term goal? If so, which provider and what budget?
3. Is Heal a local clone-stamp first, or cloud-only?
4. Is mobile/Safari support a launch requirement, or desktop-first is enough for v1?
5. Which hosting target and domain?
6. Is there any analytics you are comfortable with, given the local-first promise?
7. Backend hosting: container platform or Cloudflare Workers (`workers-rs`)?
8. Are accounts still a non-goal once cloud features carry real cost?
9. Which cloud operation ships first?

---

## Appendix A — "Definition of done" from the original brief

| # | Criterion | Status |
|---|---|---|
| 1 | Open Pictoe | ✅ |
| 2 | Import an image | ✅ |
| 3 | See it centred on the canvas | ✅ |
| 4 | Zoom and pan | ✅ |
| 5 | Select an editing tool | ✅ |
| 6 | Adjust the image smoothly | ✅ |
| 7 | See changes immediately | ✅ |
| 8 | Undo and redo | ✅ |
| 9 | Compare before/after | ✅ |
| 10 | Crop and rotate | ✅ |
| 11 | Export the result | ✅ |
| 12 | Return to the image and keep experimenting (session restore) | ✅ |

The original MVP bar is met. Everything in §6 beyond FR-01 to FR-50 is expansion beyond the MVP.

## Appendix B — Glossary

- **Non-destructive:** the original pixels are never overwritten; edits are data replayed at render time.
- **Progressive power:** capability is revealed as needed rather than shown all at once.
- **Intent:** a plain-language statement of the result a user wants.
- **Suggestion:** a proposed set of adjustment values the user can preview, apply or dismiss.
- **Local area / mask layer:** a painted region with its own adjustments, applied on top of the global edit.
- **Edit state:** the structured record of every adjustment, crop, rotation and flip.
