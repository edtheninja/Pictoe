# Pictoe: Your Image, Your Intent

Pictoe — MVP Master Build Prompt

1. Product

Build Pictoe, a modern, minimal, canvas-first image editing application designed around one core philosophy:

Your image. Your intent. Your control.

Pictoe should allow both complete beginners and experienced photographers to edit images deeply without forcing either group into an overwhelming interface.

The goal is not to make professional image editing less powerful.

The goal is to make professional-level control more approachable.

The central UX principle is:

Progressive Power — complexity should be revealed, not removed.

A beginner should be able to improve an image within seconds.

A professional should eventually be able to access precise controls, detailed adjustments, masks, curves, history, and advanced workflows without being constrained by a simplified interface.

2. MVP Philosophy

Do NOT build a generic dashboard or a conventional Lightroom clone.

Pictoe should feel:

Minimal

Modern

Immersive

Precise

Fluid

Calm

Canvas-focused

Professional without being intimidating

The photograph must remain the primary visual element.

The UI should become visually quiet when the user is focused on the image.

Avoid excessive:

Sidebars

Permanent inspectors

Dense menus

Decorative gradients

Large unnecessary headings

Excessive cards

Excessive colors

AI chat interfaces

The interface should feel closer to a modern creative instrument than an enterprise application.

3. MVP Scope

Build the first working MVP around a single powerful editor screen.

Do NOT attempt to implement every advanced photo-editing feature immediately.

The first MVP should establish:

Image import

Canvas

Zoom

Pan

Fit-to-screen

Rotate

Crop

Before/after comparison

Undo/redo

Non-destructive adjustments

Basic image adjustments

Export

Responsive desktop layout

Foundation for contextual/AI editing

Advanced AI generation, magic eraser, generative expansion, complex object removal, RAW processing, cloud synchronization, accounts, social features and collaboration should be architected for future expansion but not allowed to destabilize the MVP.

4. Editor Layout

The main editor should follow this structure:

┌────────────────────────────────────────────────────┐
│ Pictoe                         Undo  Redo    Export │
├────────────────────────────────────────────────────┤
│                                                    │
│                                                    │
│                                                    │
│                     IMAGE                          │
│                                                    │
│                                                    │
│                                                    │
│                                                    │
├────────────────────────────────────────────────────┤
│ Adjust │ Color │ Detail │ Crop │ Heal │ ✦ Intent  │
└────────────────────────────────────────────────────┘


The canvas must receive the majority of the visual attention.

Do not permanently occupy a large portion of the screen with controls.

Controls should appear contextually.

5. Visual Design

Theme

Use a dark-first interface.

The foundation should use:

Near-black canvas background

Dark neutral surfaces

Soft white primary text

Muted gray secondary text

Subtle borders

One restrained accent color

Red/danger only for destructive or warning states

Do not make every control colorful.

The photograph itself should provide most of the visual color.

6. Typography

Use a modern sans-serif such as Inter.

Suggested hierarchy:

Hero       56 / 64
H1         40 / 48
H2         32 / 40
H3         24 / 32

Body Large 18 / 28
Body       16 / 24
Body Small 14 / 20

Label      12–14


Typography should remain restrained inside the actual editor.

7. Design Tokens

Create a centralized design-token system.

Do NOT hard-code random colors, spacing values, border radii or shadows throughout the application.

Create semantic tokens for:

Colors

canvas
surface
surface-elevated
text-primary
text-secondary
text-muted
border
accent
accent-strong
danger


Spacing

xs
sm
md
lg
xl
2xl
3xl


Radius

none
sm
md
lg
xl
full


Elevation

subtle
medium
strong


The system should make future light mode possible without rewriting the application.

8. Editor Components

Create reusable components rather than putting the entire editor inside one component.

Initial component structure should include:

Editor
 ├── EditorHeader
 ├── Canvas
 ├── ToolDock
 │    ├── AdjustTool
 │    ├── ColorTool
 │    ├── DetailTool
 │    ├── CropTool
 │    ├── HealTool
 │    └── IntentTool
 │
 ├── AdjustmentPanel
 ├── IntentBar
 ├── CanvasControls
 ├── BeforeAfter
 └── ExportControl


Use clean component boundaries.

9. Image Canvas

The canvas is the heart of Pictoe.

It must support:

Import

Initially support:

JPG

JPEG

PNG

WebP

Structure the image-processing layer so additional formats can be introduced later.

Canvas interaction

Support:

Fit image

Zoom in

Zoom out

Reset zoom

Pan

Rotate

Center

Fullscreen editing

The image must remain correctly scaled and centered across different viewport sizes.

Do not distort the aspect ratio.

10. Basic Adjustments

Implement the first editing engine with:

Light

Exposure

Brightness

Contrast

Highlights

Shadows

Whites

Blacks

Color

Saturation

Vibrance

Temperature

Tint

Detail

Sharpness

Clarity

Blur

Each adjustment should have:

Slider

Numeric value

Reset behavior

Live preview

Undo support

Double-clicking or using a reset action should return an individual adjustment to its default.

11. Non-Destructive Editing

This is a fundamental architectural requirement.

NEVER permanently overwrite the original image during normal editing.

Use an editing-state model similar to:

Original Image
      ↓
Adjustment 1
      ↓
Adjustment 2
      ↓
Adjustment 3
      ↓
Current Preview


Represent edits as structured state rather than destructive pixel mutations whenever practical.

For example:

type EditState = {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;

  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;

  sharpness: number;
  clarity: number;
  blur: number;
};


This structure can evolve later into an edit graph/history system.

12. Undo / Redo

Implement proper undo and redo.

Keyboard shortcuts:

Cmd/Ctrl + Z
Cmd/Ctrl + Shift + Z


Do not reload or reconstruct the entire application when undoing.

The editing state should be independently recoverable.

13. Before / After

Provide a simple before/after interaction.

Preferred behavior:

Hold → Original
Release → Edited


Also provide an accessible button/control for users who cannot use the gesture.

The transition should be immediate and visually clear.

14. Tool Interaction

Avoid traditional permanent inspector panels.

When a tool is selected, reveal its controls.

For example:

Adjust

Light
Exposure      ─────●─────
Brightness    ───────●───
Contrast      ─────●──────
Highlights    ───●────────
Shadows       ───────●────


When the user exits the tool, controls should collapse or disappear.

This is progressive disclosure.

15. Pictoe Intent Bar

Create the visual foundation for Pictoe's signature interaction:

┌──────────────────────────────────────────────┐
│ ✦  What would you like to change?            │
└──────────────────────────────────────────────┘


This is NOT a chatbot.

It is an image-editing intent interface.

Examples:

Make the photo brighter.

Make the sky dramatic.

Make the subject stand out.

Warm the image slightly.

For the MVP, natural-language processing can be mocked or implemented with a simple intent parser.

The architecture should eventually allow an AI service to translate:

User Intent
     ↓
Detected Region / Operation
     ↓
Suggested Parameters
     ↓
Preview
     ↓
User Approval
     ↓
Edit State


The AI must suggest changes rather than silently modify the image.

The user remains in control.

16. AI Architecture

Future AI-only operations include:

Magic eraser

Generative expansion

Object removal

Background replacement

Subject isolation

Sky replacement

Intelligent relighting

Generative editing

These operations should be treated as online/cloud capabilities.

Do not attempt to force computationally expensive generative operations into the local MVP.

However, keep the architecture ready for:

Local Editing
      +
Optional Cloud AI


The application should clearly distinguish between:

Local

Fast:

Exposure

Contrast

Color

Crop

Rotate

Basic effects

Online AI

Potentially slower:

Generative expansion

Magic eraser

Object removal

AI segmentation

Generative replacement

The UI should communicate when an internet connection is required.

17. Progressive Experience

Pictoe should naturally support:

Beginner

Expose:

Enhance
Light
Color
Crop


Intermediate

Expose:

Exposure
Contrast
Highlights
Shadows
Temperature
Saturation
Detail


Advanced

Expose:

Curves
HSL
Masks
Selective adjustments
Blend modes


Professional

Eventually expose:

RAW controls
Channels
Advanced masking
Precision values
Batch processing
Edit graph
Advanced color management


Do NOT create artificial limitations.

The interface should progressively reveal capabilities.

18. Responsive Design

The first priority is desktop/laptop.

But build responsively so the architecture can eventually support:

Desktop

Tablet

Mobile

On smaller screens, the tool dock can become a horizontally scrollable bottom toolbar.

Avoid shrinking desktop panels until they become unusable.

19. Motion

Use subtle, fast transitions.

Recommended principles:

150–250ms for normal UI transitions

Smooth easing

No excessive bouncing

No decorative animations

Controls should feel fluid

Panels should softly emerge

Sliders should provide immediate feedback

Before/after should transition instantly

Motion exists to communicate state, not to decorate the application.

20. Accessibility

Implement:

Keyboard navigation

Visible focus states

ARIA labels

Accessible slider values

Sufficient contrast

Reduced-motion support

Accessible before/after controls

Do not make functionality dependent exclusively on gestures.

21. Technical Architecture

Use a clean architecture suitable for a production application.

Preferred frontend:

React
TypeScript
Vite
Tailwind CSS


Use reusable UI primitives.

Separate:

UI
↓
Editor State
↓
Image Processing
↓
Export


Do not tightly couple image manipulation to UI components.

22. State Architecture

Maintain a centralized editor state.

Conceptually:

EditorState
├── sourceImage
├── viewport
│   ├── zoom
│   ├── panX
│   └── panY
│
├── adjustments
├── crop
├── rotation
├── history
├── activeTool
├── selectedRegion
└── processingState


Keep UI state separate from image-editing state wherever possible.

23. File Structure

Prefer a structure similar to:

src/
├── components/
│   ├── editor/
│   ├── canvas/
│   ├── controls/
│   └── ui/
│
├── features/
│   ├── adjustments/
│   ├── crop/
│   ├── color/
│   ├── detail/
│   ├── history/
│   └── intent/
│
├── engine/
│   ├── image/
│   ├── transforms/
│   └── export/
│
├── state/
│   └── editor/
│
├── hooks/
├── lib/
├── types/
└── styles/


Adapt this structure to Lovable's generated project where necessary, but preserve separation of concerns.

24. Performance

Photo editing can become computationally expensive.

Therefore:

Avoid unnecessary React re-renders

Debounce expensive operations where appropriate

Use canvas/WebGL or suitable browser image-processing APIs

Keep preview rendering separate from export-quality rendering

Do not repeatedly decode the original image

Keep original image immutable

Use lower-resolution previews while interacting when necessary

Perform final-quality processing during export

The editor must feel responsive while dragging sliders.

25. Import Experience

When no image is loaded, show a beautiful minimal state:

                 Pictoe

          Drop an image here

             or

          [ Choose Image ]

       JPG · PNG · WebP


Do not create a dashboard before the user reaches the editor.

The product's primary action is:

Edit an image.

26. Export

Provide a simple export control.

Initial options:

Format
├── JPG
├── PNG
└── WebP

Quality
├── High
├── Medium
└── Custom


Later we can add:

Resolution

Metadata

Color profile

Compression

Filename

Batch export

Export should never modify the original.

27. Error Handling

Errors should be human-readable.

Avoid technical messages such as:

CanvasRenderingContext2D failed


Instead:

Pictoe couldn't process this image. Try another image or check its format.

For online AI:

This tool needs an internet connection. Your current edits remain safe.

Never silently discard user edits.

28. Important Product Rule

Do not add features simply because other photo editors have them.

Every feature should answer:

Does this help the user achieve their intended result with less friction while preserving control?

If not, don't add it to the MVP.

29. What NOT to Build Yet

Do not spend MVP time on:

Social feed

User profiles

Community

Templates marketplace

Collaboration

Cloud galleries

Complex account systems

AI chat assistant

Generative image creation

Full RAW development pipeline

Mobile-native apps

The MVP must prove the core editing experience first.

30. Definition of Done

The first MVP is successful when a user can:

Open Pictoe

Import an image

See it beautifully centered on the canvas

Zoom and pan

Select an editing tool

Adjust the image smoothly

See changes immediately

Undo and redo changes

Compare before/after

Crop/rotate the image

Export the result

Return to the image and continue experimenting

The experience should feel:

"I know exactly what I want to do, and Pictoe gets out of my way."

31. Development Rules

Build incrementally.

Do NOT generate the entire application in one giant implementation if doing so compromises quality.

Implement in this order:

Phase 1

Editor Shell

Phase 2

Canvas + Image Import

Phase 3

Basic Adjustments

Phase 4

History + Non-destructive State

Phase 5

Crop + Rotate + Before/After

Phase 6

Export

Phase 7

Intent Bar Foundation

After each phase, verify that existing functionality remains intact before continuing.

Do not replace working functionality unnecessarily.

Do not introduce mock data where real local state can be used.

32. Final Design Principle

Above everything else:

Pictoe should make the user feel like the master of the image, not the student of the software.

The application should provide guidance without taking control.

The professional should have depth.

The beginner should have confidence.

The AI should be an assistant.

The image should remain the center.

And the interface should disappear when the creative work begins.

Build the MVP around this philosophy.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/03704418-6ff5-4f6a-ac56-a194ed459498).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
