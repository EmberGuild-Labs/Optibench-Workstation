# Optibench Workstation — UI Theme: "Classic Professional" (v0.1.0-alpha)

User direction (overrides earlier dark-theme guidance): a clean, professional, LIGHT, retro
Windows 2000 / 98 classic look — bevelled grey buttons, white sunken fields, navy title bar,
etched group boxes, classic scrollbars & trackbars. Minimal background decoration. No blue/
gradient modern sliders, no glassmorphism, no glows in the chrome. Windows-only for now (macOS
paused; keep code platform-aware where it's free).

## Palette (CSS variables)
```
--face:        #d4d0c8   /* 3D face: panels, buttons, toolbars, menus */
--face-light:  #ffffff   /* bevel highlight (outer top-left) */
--face-mid:    #e6e3dc   /* subtle inner highlight */
--face-shadow: #808080   /* bevel shadow (inner bottom-right) */
--face-dark:   #404040   /* bevel dark (outer bottom-right) */
--window:      #ffffff   /* field / list / document backgrounds */
--text:        #000000
--text-disabled: #808080 (with #ffffff 1px emboss offset)
--select-bg:   #0a246a   /* navy selection */
--select-text: #ffffff
--title-active:   linear-gradient(90deg, #0a246a, #3a6ea5)   /* title bar */
--title-inactive: linear-gradient(90deg, #808080, #b5b5b5)
--progress:    #0a246a   /* chunked progress blocks */
--link:        #0000ee
```

## Typography
`font-family: Tahoma, "Microsoft Sans Serif", "Segoe UI", sans-serif; font-size: 11px;` —
crisp, no letter-spacing tricks. Monospace readouts: `"Lucida Console", Consolas, monospace`.
Underlined mnemonic letters in menus/buttons (e.g. <u>F</u>ile, <u>O</u>kay).

## Controls
- **Raised (button/toolbar button)**: `box-shadow: inset -1px -1px var(--face-dark), inset 1px 1px var(--face-light), inset -2px -2px var(--face-shadow), inset 2px 2px var(--face-mid);` background var(--face). Pressed/active: invert (dark top-left), content shifts 1px down-right. Default button gets an extra 1px black outline. Focus: 1px dotted rectangle inside.
- **Toolbar buttons**: flat until hover (thin raised bevel on hover, sunken when toggled on).
- **Sunken field (input/select/list/canvas frame)**: `box-shadow: inset 1px 1px var(--face-shadow), inset -1px -1px var(--face-light), inset 2px 2px var(--face-dark), inset -2px -2px var(--face-mid);` background var(--window).
- **Group box**: etched border (1px #808080 + 1px #fff offset), caption sits on the line on face colour.
- **Trackbar (slider)**: thin sunken groove, grey bevelled rectangular thumb with a pointed bottom; optional tick marks. NOT blue. (Style `<input type=range>` via -webkit-slider-runnable-track / -webkit-slider-thumb, or a custom component.)
- **Checkbox / radio**: white sunken square / circle with black check / dot.
- **Scrollbars**: classic — `::-webkit-scrollbar` 16px, face-coloured bevelled thumb & arrow buttons, dithered track (checkerboard of #fff/#d4d0c8 via a tiny data-URI pattern).
- **Progress bar**: sunken white field with navy chunks (or solid navy with centered % text in inverting colour like the reference).
- **Menus**: face background, raised 2px bevel border, navy highlight with white text, separators etched, shortcuts right-aligned.
- **Tabs**: classic property-sheet tabs (raised, selected tab taller and merged with the panel).
- **Title bar**: navy gradient, white bold 11px title, small app icon at left, classic caption buttons (min/max/close as small bevelled grey buttons with black glyphs) — implemented in HTML since the window is frameless.
- **Status bar**: sunken panes separated by gaps, size-grip at the bottom-right.
- **Dialogs/modals**: window frame with navy title bar, bevelled outer border, buttons bottom-right (OK / Cancel).
- Wavelength control: a sunken strip showing the visible spectrum as the *track* is fine (it's information, not decoration), with a classic grey thumb.

## Viewports (the simulation canvases)
- Framed in a sunken border.
- **Circuit viewport**: white background (classic schematic paper), light-grey dot grid, black symbols, navy selection, wires dark grey/black (user colours allowed), junction dots black. LEDs/displays/lamps still glow in their real colours (that's simulation output, not decoration).
- **Optics viewport**: light needs a dark field to read physically (additive light), so keep a plain, very dark neutral background (#101214) — NO M6 hole pattern by default (grid toggle shows a faint simple line grid), no vignette, no shimmer/photon-flow animation, bloom subtle. Component labels in a small light sans on a dark chip; selection = navy/white dotted marquee style or a crisp 1px dashed outline. Keep the physically meaningful glow (beams, detector hits, emitter apertures).
