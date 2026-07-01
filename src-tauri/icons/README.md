# Tauri icons

This directory holds the app icons used by Tauri when bundling desktop
installers (.ico for Windows, .icns for macOS, .png for Linux AppImage).

The icons are NOT included in this scaffold commit — you need to
generate them from your existing PWA icons (`public/icon-512.png`)
before running `cargo tauri build`.

## Generating icons

Use Tauri's official icon generator:

```bash
# Install the Tauri CLI first (one-time):
npm install --save-dev @tauri-apps/cli

# Generate all required icon formats from a single 1024x1024 PNG:
npx tauri icon ../public/icon-512.png
```

This will produce all the files referenced in `tauri.conf.json → bundle.icon`:
- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (macOS)
- `icon.ico` (Windows)
- plus several others for store listings

Until you run this command, `npm run tauri:dev` will work but
`npm run tauri:build` will fail with a missing-icon error.
