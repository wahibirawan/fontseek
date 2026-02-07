# FontSeek (v1.2)

A lightweight, professional font inspector for Chromium-based browsers. Click the extension icon, then click any text on the page to reveal its font details in a premium, modern popup.

**📦 Available on Edge:** [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/fontseek/dchnegjfaggohalaaenlblbbmljlhlai)
**📦 Dev Mode / Test Mode:** [Download ZIP File]([https://microsoftedge.microsoft.com/addons/detail/fontseek/dchnegjfaggohalaaenlblbbmljlhlai](https://github.com/wahibirawan/fontseek/releases/download/v1.2/FontSeek_v1.2.zip))

## Features
- **🎯 Precision Font Detection**: Identifies the *actual* rendered font, even when the browser falls back to system defaults (e.g., detects "Segoe UI" instead of "Roboto" on Windows if Roboto is missing).
- **📚 All Fonts View**: Browse all fonts used on a page with the "All Fonts" button — shows font contexts (Heading, Body, Nav, etc.) and weights.
- **🎨 Advanced Color Engine**: Uses Canvas API to resolve *any* modern CSS color format (`lab`, `oklch`, `display-p3`, etc.) into standard HEX/RGB.
- **💎 Premium Glass UI**: A beautiful, dark glassmorphism interface with tactile buttons and smooth animations.
- **📋 Multi-Format Copy**: Dedicated buttons to copy colors in **HEX**, **RGB**, **HSL**, and **CMYK**.
- **🔍 Smart Inspection**: Shows Weight (with name), Style, Size, Line Height, Letter Spacing, and Decoration.
- **🔒 CSP-Safe & Lightweight**: Built with Shadow DOM and zero `innerHTML` usage for maximum security and performance. Zero external dependencies.

## How to use (Development)
1. Go to Edge/Chrome Extensions (`edge://extensions` or `chrome://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Pin **FontSeek**, then click its icon to start picking.
5. Click any text to inspect. Press **ESC** or click the **Exit** pill to stop.
6. Use **"All Fonts"** button to see all fonts on the page at once.

## Permissions
- `activeTab` + `scripting`: Required to inject the inspection engine into the current tab only when you activate it.

## Privacy
- We do **not** collect, store, or transmit any user data. Everything runs locally in your browser.

## License
MIT License © 2026 Wahib Irawan

## Change Notes
### v1.2 - February 8, 2026
- **🆕 "All Fonts" popup**: View all fonts used on a page with context tags (Heading, Body, Nav, Button, etc.).
- **💎 Premium Glassmorphism UI**: Redesigned popup with frosted glass effect, tactile buttons, and smooth animations.
- **🔧 CSP Compatibility**: Fixed popup visibility on strict CSP sites (Shopify, Framer, etc.).
- **📍 Improved Positioning**: Popup now correctly positioned within viewport on all sites.
- **🎭 Toolbar Auto-hide**: Toolbar hides when All Fonts popup is open, restores on close.

### v1.1 - Previous
- Enhanced font detection for modern sites (Shopify, Framer, Webflow).
- Multi-strategy font resolution with CSS variables and @font-face scanning.

### v1.0.1 - September 11, 2025
- Change search engine to Bing.com (Microsoft Edge).
- Improved font search result.

### v1.0 - Initial Release
- Accurate font resolution with OS alias handling.
- Font details: Family, Style, Weight, Size, Letter Spacing, Line Height, Color.
- Color swatch with multi-format copy.
- CSP-safe Shadow DOM UI.
