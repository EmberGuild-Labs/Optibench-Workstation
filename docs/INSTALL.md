# Optibench Workstation — Building the installer

Packaging uses **electron-builder** with `electron-builder.yml` at the project root.
Build resources (icons, installer art, entitlements) live in `build/`.

## Prerequisites

- Node.js (same version used for development) and `npm install` already run.
- Windows 10/11 x64 for the Windows installer. NSIS is downloaded by electron-builder on first use.
- macOS (Apple silicon or Intel) with Xcode command-line tools for the mac build.

## 1. Regenerate icons and installer artwork

```bash
npm run icons
```

Runs `scripts/build-icons.mjs` (sharp + png-to-ico). It reads `build/icon.svg` and
`build/icon-small.svg` and writes:

- `build/icons/{16,24,32,48,64,128,256,512,1024}.png`, `build/icon.png` (512)
- `build/icon.ico`, `build/file-icon.ico` (16–256)
- `build/icon.iconset/`, `build/file-icon.iconset/` (macOS source sets)
- `build/installerSidebar.bmp` (164×314) and `build/installerHeader.bmp` (150×57), 24-bit BMP
- `build/file-icon.svg`, `build/logo-wordmark.svg` (+ `.png` preview)

The outputs are kept in the repository, so this step is only required after changing the artwork.

## 2. Windows installer (NSIS, x64)

```bash
npm run dist:win
```

This runs `electron-vite build` (→ `out/`) and then `electron-builder --win`.

Output: `release/<version>/Optibench-Workstation-Setup-<version>.exe`
(e.g. `release/0.1.0-alpha/Optibench-Workstation-Setup-0.1.0-alpha.exe`). The unpacked app is in
`release/<version>/win-unpacked/` — handy for a quick smoke test without installing.

Installer behaviour:

- Assisted (not one-click) installer, per-user by default (no admin needed); the user can choose
  the install directory. Shows `LICENSE.txt` and the branded sidebar/header.
- Creates Desktop and Start Menu shortcuts named "Optibench Workstation"; launches the app when done.
- Registers `.obw` → "Optibench Project" with `build/file-icon.ico`. Double-clicking a project
  starts the app with the file path in `process.argv` (handled in `src/main`).
- Example projects from `examples/*.obw` are installed to `<install dir>/resources/examples`
  (`process.resourcesPath + '/examples'` at runtime).
- Uninstall keeps the user's app data (`%APPDATA%/Optibench Workstation`).

### Code signing / SmartScreen

Builds are currently **unsigned** (no certificate configured; electron-builder skips signing when
`CSC_LINK` is not set). Windows Defender SmartScreen will warn: "Windows protected your PC" →
**More info** → **Run anyway**. Before public release, obtain an OV/EV code-signing certificate
(or Azure Trusted Signing) and set `CSC_LINK` / `CSC_KEY_PASSWORD` (or `win.azureSignOptions`).
Reputation builds up per certificate, EV certificates get immediate SmartScreen trust.

## 3. macOS (planned — not built yet)

Configured in `electron-builder.yml` (`mac`, `dmg`): dmg + zip for **x64 and arm64**, hardened
runtime, `build/entitlements.mac.plist`, `.obw` document type + exported UTI `com.optibench.obw`.

On a Mac:

```bash
npm install
npm run icons        # on macOS this also runs iconutil -> build/icon.icns, build/file-icon.icns
# or manually:
iconutil -c icns build/icon.iconset -o build/icon.icns
iconutil -c icns build/file-icon.iconset -o build/file-icon.icns
npm run dist:mac
```

Output: `release/<version>/Optibench-Workstation-<version>-{x64,arm64}.{dmg,zip}`.
If `build/icon.icns` is missing electron-builder converts `build/icon.png` instead; without
`build/file-icon.icns` `.obw` documents show the app icon.

### Signing and notarization

- Unsigned local test build: `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac`
  (Gatekeeper will block it on other Macs; right-click → Open, or `xattr -cr` the app).
- Release: a **Developer ID Application** certificate in the keychain (or `CSC_LINK` +
  `CSC_KEY_PASSWORD`). Hardened runtime is already enabled, which notarization requires.
- Notarization (electron-builder uses `notarytool`): set `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (or an App Store Connect API key:
  `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`). The ticket is stapled automatically.
- Review `build/entitlements.mac.plist` before the first signed build; drop
  `disable-library-validation` if no third-party native modules are shipped.

## Troubleshooting

- *"default Electron icon is used"* — run `npm run icons`; check `build/icon.ico` exists.
- *Installer art looks wrong* — NSIS requires 24-bit uncompressed BMP at exactly 164×314
  (sidebar) and 150×57 (header); the script's encoder produces exactly that.
- *Version shows oddly in Windows properties* — NSIS needs a numeric version; electron-builder
  maps `0.1.0-alpha` to `0.1.0.0` for the file version.
