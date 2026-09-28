# 🖼️ Pictoe

### Your image. Your intent. Your control.

Pictoe is a **canvas-first, local-first image editor** built around a simple idea:

> Professional-level editing power shouldn't require professional-level complexity up front.

Instead of overwhelming users with dozens of controls, Pictoe progressively reveals editing power when it is needed. A beginner can improve an image in seconds, while advanced controls remain available for deeper editing.

Pictoe is designed as a **browser-based, non-destructive image editing experience** where the original image remains untouched and edits are represented as structured editor state.

---

## ✨ What Pictoe Does

Pictoe currently provides a complete local image-editing workflow:

- 🖼️ Canvas-based image editing
- 🔍 Cursor-centered zoom
- ✋ Pan and automatic fit-to-screen
- 🎛️ 14 non-destructive image adjustments
- ✂️ Crop with aspect-ratio presets
- 🔄 Rotation and flipping
- ↩️ Full undo/redo
- 🕘 Direct-access edit history
- 👁️ Before/After comparison
- 💬 Natural-language Intent Bar
- 🧠 Client-side image analysis
- 🎨 Built-in presets
- 💾 Custom local presets
- 💽 Persistent editing sessions
- 📤 JPG, PNG and WebP export
- 📱 Responsive desktop and mobile editing layouts

Everything currently runs locally in the browser.

No image needs to be uploaded to a server for normal editing.

---

# 🎨 Core Experience

## Canvas

The canvas is the center of the Pictoe experience.

Users can:

- Zoom around the cursor
- Pan across the image
- Fit the image automatically to the available workspace
- Work with a responsive editing interface
- Compare edits directly against the original

Desktop uses a **docked editing panel**, while mobile uses a **bottom-sheet editing experience** rather than simply shrinking the desktop interface.

---

# 🎛️ Non-Destructive Editing

Pictoe currently supports **14 global image adjustments**.

### Light

- Exposure
- Brightness
- Contrast
- Highlights
- Shadows
- Whites
- Blacks

### Color

- Saturation
- Vibrance
- Temperature
- Tint

### Detail

- Clarity
- Sharpness
- Blur

Edits do not modify the original image file.

Instead, Pictoe stores the editing parameters as structured state and applies those parameters during rendering and export.

This makes editing reversible and allows the same source image to support multiple edit states.

---

# ✂️ Crop & Transform

Pictoe includes a dedicated crop and transformation workflow.

### Crop

Supported aspect-ratio presets allow users to quickly prepare images for different formats and compositions.

### Transform

- Rotate
- Flip horizontally
- Flip vertically

Crop and transform operations are integrated into the editor state rather than permanently modifying the source image.

---

# 🕘 History

Pictoe provides full editing history with:

- Undo
- Redo
- Direct history navigation
- Past and future edit states

Instead of displaying technical state information, history entries use plain-language descriptions such as:

```text
Exposure +18
Contrast -10
Warmth +12
Crop / rotate
```
