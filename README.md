# 📷 Pictoe

### **Your image. Your intent. Your control.**

Pictoe is a **canvas-first, non-destructive image editor** designed around one principle:

> **Professional editing power shouldn't require professional-level complexity up front.**

Instead of overwhelming users with every control immediately, Pictoe progressively reveals editing power as needed. A beginner can make meaningful improvements in seconds, while advanced controls remain one interaction away.

Pictoe runs primarily in the browser, keeping editing state local and preserving the original image throughout the editing workflow.

---

## ✨ What Pictoe Can Do Today

### 🖼️ Canvas

A responsive editing canvas designed around the image itself.

- Cursor-centered zoom
- Pan and navigation
- Automatic fit-to-screen
- Responsive canvas behavior
- Docked editing panel on desktop
- Bottom-sheet editing interface on mobile
- Canvas-first workspace rather than a traditional form-based editor

The desktop and mobile interfaces are intentionally designed as separate experiences rather than simply scaling one layout down.

---

### 🎚️ Non-Destructive Editing

Pictoe currently provides **14 global image adjustments** across three categories.

#### Light

- Exposure
- Brightness
- Contrast
- Highlights
- Shadows
- Whites
- Blacks

#### Color

- Saturation
- Vibrance
- Temperature
- Tint

#### Detail

- Clarity
- Sharpness
- Blur

All adjustments are represented as structured editor state.

**The original image is never modified.**

Edits are applied during rendering/export, allowing users to freely experiment and undo changes without degrading the source image.

---

### ✂️ Crop & Transform

Pictoe also provides basic composition and transformation tools:

- Crop
- Aspect-ratio presets
- Rotation
- Horizontal flip
- Vertical flip

These operations remain part of the non-destructive editing workflow.

---

## ↩️ History & Undo / Redo

Pictoe provides a full editing history rather than limiting users to simple step-by-step undo.

### Undo / Redo

Users can freely move backward and forward through their editing states.

### History Panel

The history panel displays previous and future editor states using **plain-language descriptions**.

Examples:

```text
Original
Exposure +18
Contrast +12
Temperature -6
Crop / rotate
Saturation +9
```

Users can click any history entry to jump directly to that state.

This makes experimentation much safer and more understandable than a conventional undo stack.

---

## 👀 Before / After

Pictoe includes a dedicated comparison workflow.

### Hold to Compare

Press and hold the comparison control to temporarily view the original image.

### Keyboard Accessible

A keyboard-accessible toggle is also available so comparison does not depend solely on pointer or touch interaction.

This keeps the feature usable across different interaction methods.

---

# 🧠 Intent Bar

One of Pictoe's core features is the **Intent Bar**.

Instead of requiring users to know which slider they need, they can simply describe what they want.

Examples:

```text
make it warmer
add drama
make it brighter
make the colors pop
reduce the highlights
make it softer
```

Pictoe interprets the request and proposes a **specific adjustment patch**.

The proposed change is:

1. Parsed from the user's intent
2. Converted into concrete editor adjustments
3. Previewed live
4. Applied only when the user accepts it

Users can therefore work with the image using either traditional controls or natural-language intent.

---

## 🔍 Local Image Analysis

Intent suggestions are not completely generic.

Pictoe performs a lightweight **client-side image analysis pass** to understand the current image.

Analysis includes signals such as:

- Overall luminance
- Highlight clipping
- Shadow characteristics
- Color-temperature bias
- General tonal balance

This allows suggestions to adapt to the actual image.

For example, a request such as:

> "brighten this"

can produce a more meaningful adjustment on a genuinely dark photograph than on an already-bright image.

### Proactive Suggestions

Pictoe can also identify potential improvements without the user typing anything.

For example:

> **“This image looks a little dark.”**

The user can then preview the suggested adjustment before applying it.

All of this analysis currently happens **locally in the browser**.

No image needs to be uploaded to a remote AI service for these suggestions.

---

# 🎨 Presets

Pictoe includes five built-in looks:

| Preset            | Style                          |
| ----------------- | ------------------------------ |
| **Warm Film**     | Warm, cinematic tones          |
| **Moody B&W**     | High-impact monochrome         |
| **Vivid Pop**     | Stronger color and vibrance    |
| **Cool Blue**     | Cooler tonal atmosphere        |
| **Soft Portrait** | Softer, more subtle appearance |

### Custom Presets

Users can also:

- Save the current editing state as a preset
- Reuse saved presets
- Delete custom presets

Custom presets are stored locally.

---

# 💾 Session Persistence

Pictoe is designed so that closing the browser does not necessarily mean losing the current editing session.

The most recent image and its associated editing state are automatically persisted locally using **IndexedDB**.

When the user returns:

```text
Open Pictoe
      ↓
Restore previous session
      ↓
Continue editing
```

### Explicit Close

If the user intentionally closes an image from the editor, the saved session is cleared.

This prevents an intentionally closed project from unexpectedly reappearing later.

---

# 📤 Export

Finished images can be exported in three formats:

- **JPG**
- **PNG**
- **WebP**

Pictoe provides predefined export quality options:

```text
High
Medium
Small
```

For JPG and WebP, users can also choose a custom quality level using a:

```text
1% ───────────────────── 100%
```

quality slider.

This gives users control over the balance between image quality and file size.

---

# 📱 Responsive Editing Experience

Pictoe does not simply shrink the desktop interface for smaller screens.

### Desktop

```text
┌─────────────────────────────────────────────┐
│ Header                                      │
├──────────────────────────────┬──────────────┤
│                              │              │
│                              │   Controls   │
│           Canvas             │              │
│                              │              │
│                              │              │
└──────────────────────────────┴──────────────┘
```

### Mobile

The editing controls transition into a **bottom-sheet workflow**, allowing the image to remain the primary focus.

The goal is to make Pictoe feel like a purpose-built editor on every screen size.

---

# 🚧 What's Not Built Yet

Pictoe's architecture anticipates more advanced functionality, but the following features are **not currently implemented**.

### ☁️ Cloud / Generative Operations

Planned capabilities include:

- Object removal
- Generative expansion
- Sky replacement
- Background replacement
- Subject isolation

These operations require cloud/AI processing and are therefore explicitly identified as unavailable rather than simulated.

---

### 🎯 Selective Adjustments

Current adjustments are global:

> An adjustment affects the entire image.

Future versions may support:

- Masks
- Brush-based adjustments
- Region selection
- Local exposure
- Local color
- Selective blur
- Subject-specific adjustments

---

### 🎨 Advanced Color Controls

Not currently implemented:

- Curves
- HSL
- Color grading
- Advanced channel controls

---

### 📚 Batch Workflows

Batch editing and multi-image workflows are also planned for future development.

---

# 🏗️ Architecture

Pictoe follows a feature-oriented structure with a clear separation between the editor UI, image engine, state management, and persistence layers.

```text
src/
│
├── components/
│   ├── canvas/
│   │   ├── Canvas
│   │   ├── CanvasControls
│   │   └── CropOverlay
│   │
│   ├── controls/
│   │   └── AdjustmentSlider
│   │
│   ├── editor/
│   │   ├── Editor
│   │   ├── EditorHeader
│   │   ├── HistoryPanel
│   │   ├── AdjustmentPanel
│   │   ├── BeforeAfter
│   │   ├── ExportControl
│   │   ├── ImportScreen
│   │   └── ToolDock
│   │
│   └── ui/
│       └── Radix / shadcn-style primitives
│
├── engine/
│   ├── image/
│   │   ├── load.ts
│   │   ├── render.ts
│   │   └── analyze.ts
│   │
│   └── storage/
│       ├── session.ts
│       └── presets.ts
│
├── features/
│   ├── adjustments/
│   │   └── AdjustmentGroup
│   │
│   ├── crop/
│   │   └── CropTool
│   │
│   ├── intent/
│   │   ├── IntentBar
│   │   └── parseIntent
│   │
│   └── presets/
│       ├── PresetsPanel
│       └── builtinPresets
│
├── state/
│   └── editor/
│       └── EditorContext
│
├── types/
│   └── editor.ts
│
└── routes/
```

---

# 🧩 Core Architecture Principles

### Non-Destructive State

The original image remains untouched.

```text
Original Image
      +
Editor State
      ↓
Render
      ↓
Preview / Export
```

---

### Local-First

Where possible, Pictoe performs processing locally:

- Image analysis
- Editing state
- Presets
- Session persistence

This reduces unnecessary network dependency and keeps the editing workflow responsive.

---

### Progressive Complexity

Pictoe follows a simple interaction philosophy:

```text
Simple request
      ↓
Quick result
      ↓
Optional deeper control
      ↓
Advanced editing
```

Users don't need to understand every editing parameter before they can start.

---

# 🛠️ Tech Stack

| Technology                  | Purpose                            |
| --------------------------- | ---------------------------------- |
| **React 19**                | UI framework                       |
| **TypeScript**              | Type safety                        |
| **Vite 8**                  | Development & build tooling        |
| **TanStack Router / Start** | Application routing                |
| **Tailwind CSS 4**          | Styling                            |
| **Radix UI**                | Accessible UI primitives           |
| **lucide-react**            | Icons                              |
| **React Query**             | Data/query management              |
| **Zod**                     | Validation                         |
| **Bun**                     | Package/runtime tooling            |
| **IndexedDB**               | Local session & preset persistence |

---

# 🚀 Getting Started

## Clone

```bash
git clone https://github.com/edtheninja/Pictoe.git
```

## Enter the project

```bash
cd Pictoe
```

## Install dependencies

```bash
npm i
```

## Start the development server

```bash
npm run dev
```

Then open the local development URL shown by Vite.

---

# 🧪 Development Philosophy

Pictoe is being developed incrementally with a focus on maintaining existing editor behavior while expanding functionality.

The guiding principles are:

- **Don't break existing editing workflows**
- **Keep image editing non-destructive**
- **Prefer local processing where practical**
- **Keep advanced functionality optional**
- **Maintain responsive desktop and mobile experiences**
- **Make every action understandable**
- **Never pretend unavailable AI/cloud features are implemented**

---

# 🗺️ Roadmap

### ✅ Current

- [x] Canvas editing workspace
- [x] Zoom and pan
- [x] Fit-to-screen
- [x] Responsive desktop/mobile editor
- [x] 14 image adjustments
- [x] Crop
- [x] Rotation
- [x] Flip
- [x] Undo / redo
- [x] Jumpable history
- [x] Before / After
- [x] Intent Bar
- [x] Local image analysis
- [x] Proactive image suggestions
- [x] Built-in presets
- [x] Custom presets
- [x] IndexedDB session persistence
- [x] JPG / PNG / WebP export
- [x] Export quality controls

### 🔜 Future

- [ ] Selective / masked adjustments
- [ ] Curves
- [ ] HSL controls
- [ ] Advanced color grading
- [ ] Batch editing
- [ ] Object removal
- [ ] Generative expansion
- [ ] Sky replacement
- [ ] Background replacement
- [ ] Subject isolation
- [ ] Cloud-powered AI operations

---

# 🎯 Philosophy

Pictoe isn't trying to make image editing more complicated.

It's trying to make powerful editing **easier to approach**.

A user should be able to open an image and immediately understand:

```text
What can I do?
        ↓
What should I change?
        ↓
What will it look like?
        ↓
Do I want to keep it?
```

Whether the user wants a one-tap improvement or precise manual control, Pictoe keeps the image at the center of the experience.

---

## 📜 License

This project is currently developed as a personal/project application.

Add the appropriate license here before distributing the project publicly.

---

<p align="center">

### **Pictoe**

**Your image. Your intent. Your control.**

Built with React, TypeScript and a canvas-first editing philosophy.

</p>

---

_Originally scaffolded with [Lovable](https://lovable.dev); developed locally since._
