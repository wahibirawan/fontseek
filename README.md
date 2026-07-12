# FontSeek (v1.3)

FontSeek is a lightweight, professional font inspector for Chromium-based browsers. Clicking the extension icon and selecting any text on a page reveals its font details in a modern, frosted glass popup.

The extension is available for download on the [Microsoft Edge Add-ons Store](https://microsoftedge.microsoft.com/addons/detail/fontseek/dchnegjfaggohalaaenlblbbmljlhlai).

Development Version [Download for Chromium Based Browsers](https://github.com/wahibirawan/fontseek/releases).

## Features

*   **Precision Font Detection**: Identifies the actual rendered font, even when the browser falls back to system defaults. For example, it detects Segoe UI instead of Roboto on Windows if Roboto is not installed on the system.
*   **All Fonts View**: Browse all fonts used on a page via the All Fonts panel. It displays font contexts such as Heading, Body, Nav, and Button along with font weights.
*   **Advanced Color Engine**: Resolves modern CSS color formats (including lab, oklch, and display-p3) into standard HEX and RGB formats using the Canvas API.
*   **Tactile User Interface**: A modern interface featuring a dark glassmorphism card with responsive controls and smooth transitions.
*   **Multi-Format Copy**: Quick-copy buttons to copy colors in HEX, RGB, HSL, and CMYK formats.
*   **Style Inspection**: Shows font weight, style, size, line height, letter spacing, and text decoration.
*   **CSP-Safe and Self-Contained**: Built using Shadow DOM and clean DOM manipulation without unsafe innerHTML rendering. It has zero external dependencies.

## Installation for Developers

1. Open the Extensions settings in Chrome or Edge (at `chrome://extensions` or `edge://extensions`).
2. Turn on the **Developer mode** toggle.
3. Click **Load unpacked** and select this directory.
4. Pin the FontSeek extension to the toolbar, then click its icon to start picking.
5. Click any text to inspect. Press the **Escape** key or click the exit button to stop.
6. Use the **All Fonts** button to scan all fonts on the page.

## Permissions

*   `activeTab` and `scripting`: Required to load and run the inspection engine on the current tab only when explicitly clicked.

## Privacy

FontSeek does not collect, store, or transmit any user data. All processing occurs locally within your browser context. For more details, refer to [PRIVACY.md](PRIVACY.md).

## License

MIT License © 2026 Wahib Irawan

## Changelog

### v1.3
*   Transitioned to a Hybrid Click-Shield System, replacing the full-screen transparent overlay. The browser now handles page scrolling 100% natively, eliminating all scroll lag and redraw flicker on resource-heavy animated sites.
*   Implemented Range-Based Text Bounding Highlights. Visual highlights (both hover preview and click selection) now wrap strictly around the text node dimensions, excluding adjacent SVGs, icons, and button paddings.
*   Refactored the element inspection picker to resolve layout containers (such as navigation wrappers, button nodes, and anchors) to their innermost text-bearing child nodes.
*   Removed the automatic All Fonts view fallback completely to prevent unexpected popup overlays. The All Fonts view is now strictly triggered on-demand by clicking the All Fonts button.

### v1.2
*   Added the All Fonts panel to inspect all fonts on a page with context tags.
*   Redesigned the card with a glassmorphism interface and improved transitions.
*   Fixed popup rendering on strict Content Security Policy (CSP) sites such as Shopify and Framer.
*   Corrected popup boundaries to keep it visible inside the viewport boundaries on all websites.
*   Disabled automatic panel popups; the All Fonts list now only opens when clicked.

### v1.1
*   Enhanced font resolution and event capturing for modern sites including Shopify, Framer, and Webflow.
*   Improved multi-strategy font resolution using CSS variables and font-face scanning.

### v1.0.1
*   Changed font search redirection to Bing.com.
*   Improved font search results formatting.

### v1.0
*   Initial release.
*   Added basic font detail resolution (Family, Style, Weight, Size, Letter Spacing, Line Height, Color).
*   Added color swatch with multi-format color copying.
*   Designed the secure Shadow DOM user interface.
