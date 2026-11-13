# Shishi visual design

The interface is styled from one token file, `UI/tokens.css`, plus an icon set in `UI/icons.css`. Every other stylesheet reads those names, and the native window colours in `main.swift` (`ShishiSurface`) mirror `--canvas` and `--paper`.

## Direction: Paper & Indigo

- **Surfaces.** `canvas` is the desk (sidebar, window chrome), `paper` is the sheet you work on, `raised` is a slip resting on it (cards, menus, the selected sidebar item), `sunken` is a well (quotes, code).
- **Colour.** Warm neutrals carry almost everything. Indigo is the single working accent: links, focus, selection, primary actions, progress. Cinnabar is reserved for what is new or urgent: unread, P0, overdue.
- **Type.** System sans for work, the system serif (New York, Songti for Chinese) for page titles, sheet titles and the headline of an opened result.
- **Status.** Each state has a shape and a word as well as a colour; see the table at the top of `UI/results.css`. A filled glyph with a solid frame means Shishi read the outcome from the service itself (a GitHub Actions run). A dashed, hollow glyph labelled "Reported by agent · not observed" marks a check the agent only says it made.

Two alternatives were explored on the same screens and are kept in `explorations/` as token overrides. They are not loaded by the app.

## Checking changes without opening the app

The harness renders the real `UI/` files in headless Chromium with a mocked native host.

```sh
cd Design/harness
node shots.js ../screens                 # every scene, light and dark
node shots.js out --only today,compact   # a subset
node shots.js out --css ../explorations/direction-b-dusk-glass.css
node behavior.js                         # incoming results must not displace reading or typing
python3 contrast.py                      # WCAG contrast of the token pairs in use
```

These are Chromium renders with fallback fonts (Inter, Charter). On macOS the same CSS resolves to San Francisco and New York inside WKWebView.
