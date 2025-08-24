# FontSeek (v1.0)

A lightweight font picker for Chromium-based browsers. Click the extension icon, then click any text on the page to reveal its font details in a clean, modern popup.

## Features
- **Accurate font resolution**: Detects the *actual* font used on your OS (handles aliases like `-apple-system`).  
- **Details shown**: Font Family, Style, Weight (with name), Size, Letter Spacing, Line Height, Color.  
- **Color swatch**: Hover shows RGB/HSL, click to copy (HEX by default, Ctrl/⌘ → RGB, Alt → HSL).  
- **Search font**: Quick Google search button next to the font name.  
- **CSP-safe UI**: Uses Shadow DOM with constructable stylesheet.  
- **Zero external deps**: No frameworks, minimal footprint.

## How to use (Development)
1. Go to `chrome://extensions` (or Edge `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Pin **FontSeek**, then click its icon to start picking. Press **ESC** or click **Exit** pill to stop.

## Permissions
- `activeTab` + `scripting`: required to inject the content script into the current tab when you click the extension icon.

## Notes
- We do **not** collect any data. See `PRIVACY.md`.
- Minimum Chrome version: 114 (tested on latest stable).
