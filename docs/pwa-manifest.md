# PWA Manifest

The application exposes its generated Next.js manifest at `/manifest.webmanifest`. Root metadata must link to this route so browsers can install and audit the app correctly.

## Icons

The manifest references only files that exist in `ui/public/`:

- `/favicon-16x16.png`
- `/favicon-32x32.png`
- `/favicon.ico`
- `/apple-touch-icon.png`
- `/android-chrome-192x192.png`
- `/android-chrome-512x512.png`

The Android icons are marked `maskable` so install surfaces can crop them safely.

## Colors

- `background_color` is `#ffffff`, matching the light-mode splash/background fallback.
- `theme_color` is `#171717`, matching the neutral dark app chrome used by the design tokens.

The app itself still supports runtime light and dark themes through CSS variables; the manifest colors are the browser install/splash defaults.
