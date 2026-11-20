# Optibench Workstation — Branding

## The mark

A rounded-square app tile in a deep navy → indigo gradient holding a crisp glass prism.
A single white beam enters the left face, refracts through the glass and leaves the right
face as a seven-band spectral fan (red least deviated, violet most). A faint laser-cyan
circuit trace in the lower-left corner nods to the electronics co-simulation.

| File | Purpose |
|---|---|
| `build/icon.svg` | Master icon (1024 × 1024). Used for rasters ≥ 64 px. |
| `build/icon-small.svg` | Hinted variant for 16–48 px: full-bleed tile, heavier prism stroke and beam, 5 spectral bands, no circuit/sheen detail. |
| `build/file-icon.svg` | `.obw` document icon (dark page, folded corner, prism glyph, cyan `.obw` label). *Generated.* |
| `build/logo-wordmark.svg` | Icon + "Optibench Workstation" wordmark, light text for dark backgrounds. *Generated.* |
| `build/logo-wordmark.png` | 2× raster preview of the wordmark. |
| `build/icon.png`, `build/icons/*.png` | App icon rasters (512 and 16–1024). |
| `build/icon.ico`, `build/file-icon.ico` | Windows icons (16, 24, 32, 48, 64, 128, 256). |
| `build/installerSidebar.bmp`, `build/installerHeader.bmp` | NSIS artwork (164 × 314 and 150 × 57, 24-bit). `*.preview.png` copies are for review only. |

All rasters are produced by `npm run icons` (`scripts/build-icons.mjs`). Generated SVGs are
overwritten on every run — change the script, not the output.

### Wordmark lettering

The wordmark uses a custom monoline geometric sans drawn as stroked paths inside the
build script (no font dependency, renders identically everywhere). "Optibench" is set in
the heavier weight in Text colour; "Workstation" in a lighter weight in `#AEB9CC`.
In product UI, where live text is needed, use **Inter** (fallback: `"Segoe UI", system-ui,
-apple-system, sans-serif`), weight 600 for "Optibench", 400 for "Workstation".

### Usage rules

- Minimum size: icon 16 px (use the small variant ≤ 48 px); wordmark 120 px wide.
- Clear space: at least ¼ of the icon height on every side.
- Place the light wordmark only on dark backgrounds (`#0B0F17` – `#1F2A3D` range). There is no
  dark-on-light wordmark yet — on light backgrounds use the icon alone.
- Do not recolour the spectrum, rotate the prism, add outlines/drop shadows or stretch the tile.
- The spectrum order is physical (red top → violet bottom). Keep it.

## Colour

### UI palette (dark theme)

| Token | Hex | Use |
|---|---|---|
| `--ob-bg` | `#0B0F17` | App background, viewport clear colour |
| `--ob-panel` | `#111826` | Panels, sidebars, inspector |
| `--ob-panel-raised` | `#162033` | Hovered rows, popovers, menus |
| `--ob-border` | `#1F2A3D` | Dividers, panel borders, input outlines |
| `--ob-text` | `#E6EDF7` | Primary text |
| `--ob-muted` | `#8A97AD` | Secondary text, labels, disabled icons |
| `--ob-accent` | `#3DE0FF` | Laser cyan — primary accent, selection, focus ring, active tool |
| `--ob-accent-2` | `#8B5CFF` | Violet — secondary accent, co-sim / circuit highlights |
| `--ob-success` | `#4BE37A` | Running / OK |
| `--ob-warning` | `#FFD23F` | Warnings |
| `--ob-danger` | `#FF3B5C` | Errors, laser-hazard indicators |

Focus ring: `0 0 0 2px #3DE0FF66`. Selection fill: `#3DE0FF1F`.

### Brand gradients

| Token | Value |
|---|---|
| `--ob-grad-tile` | `linear-gradient(135deg, #0A1230 0%, #18205C 55%, #3A1E8C 100%)` (icon tile) |
| `--ob-grad-accent` | `linear-gradient(90deg, #3DE0FF 0%, #8B5CFF 100%)` (primary buttons, progress) |
| `--ob-grad-spectrum` | `linear-gradient(90deg, #FF3B5C, #FF8A3D, #FFD23F, #4BE37A, #3DE0FF, #4A7BFF, #8B5CFF)` (hairline rules, splash) |
| `--ob-glow` | `radial-gradient(circle, #6D7CFF61 0%, #6D7CFF00 70%)` |

### Spectrum (logo fan, top → bottom)

`#FF3B5C` · `#FF8A3D` · `#FFD23F` · `#4BE37A` · `#3DE0FF` · `#4A7BFF` · `#8B5CFF`

These are stylised, not wavelength-accurate. For physically meaningful beam colours in the
optics viewport use the engine's wavelength → sRGB mapping instead.

### CSS starter

```css
:root {
  --ob-bg: #0B0F17; --ob-panel: #111826; --ob-panel-raised: #162033; --ob-border: #1F2A3D;
  --ob-text: #E6EDF7; --ob-muted: #8A97AD;
  --ob-accent: #3DE0FF; --ob-accent-2: #8B5CFF;
  --ob-success: #4BE37A; --ob-warning: #FFD23F; --ob-danger: #FF3B5C;
  --ob-grad-accent: linear-gradient(90deg, #3DE0FF 0%, #8B5CFF 100%);
  --ob-grad-spectrum: linear-gradient(90deg, #FF3B5C, #FF8A3D, #FFD23F, #4BE37A, #3DE0FF, #4A7BFF, #8B5CFF);
  --ob-font: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
}
```

## Naming

- Product: **Optibench Workstation** (two words, capital O and W). Short form: **Optibench**.
- File type: **Optibench Project** (`.obw`), MIME `application/x-optibench`, UTI `com.optibench.obw`.
- App ID: `com.optibench.workstation`.
