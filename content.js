/**
 * FontSeek — Font Inspector
 * (c) 2025 Wahib Irawan — MIT License
 */

(() => {
  // prevent double activation
  if (window.__FS_ACTIVE__) { window.__FS_API__?.stop(); return; }
  window.__FS_ACTIVE__ = true;

  // globals
  let exitEl, highlightEl;
  let clickHandler, keyHandler;
  let lastClick = { x: 24, y: 24 };

  // popup (shadow)
  let popupHost = null, popupRoot = null, popupCard = null, rowsEl = null;

  // DOM Utils
  const isTextual = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    // Relaxed: allow visibility:hidden if element has text (some sites hide then show)
    return cs.display !== "none" && cs.fontSize !== "0px";
  };
  const hasAnyText = (el) => {
    if (!el) return false;
    if ((el.textContent || "").trim().length > 0) return true;
    return Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && (n.nodeValue || "").trim().length > 0);
  };
  const ascend = (node) => {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode && node.getRootNode();
    if (root && root.host) return root.host;
    return null;
  };

  // Deep Shadow DOM Penetration — recursively pierce through Shadow DOMs
  const deepElementFromPoint = (x, y) => {
    let el = document.elementFromPoint(x, y);
    if (!el) return null;

    // Pierce through all shadow roots
    let iterations = 0;
    const MAX_DEPTH = 10; // Prevent infinite loops
    while (el && iterations < MAX_DEPTH) {
      const shadow = el.shadowRoot;
      if (!shadow) break;

      const inner = shadow.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
      iterations++;
    }
    return el;
  };

  // Caret-based text detection — for when event targets fail
  const getElementFromCaret = (x, y) => {
    // Try caretPositionFromPoint (Firefox/standard) or caretRangeFromPoint (Chrome/Safari)
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos?.offsetNode?.parentElement) return pos.offsetNode.parentElement;
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range?.startContainer?.parentElement) return range.startContainer.parentElement;
    }
    return null;
  };

  // Tracking flag for forced detection mode
  let usedForcedMode = false;

  // Check if element is a likely "overlay" or container without real text
  const isOverlayElement = (el) => {
    if (!el || el.nodeType !== 1) return true;
    const tag = el.tagName?.toLowerCase();
    // Common overlay/container tags that often don't have direct text
    const overlayTags = new Set(["video", "iframe", "canvas", "svg", "img", "picture", "source"]);
    if (overlayTags.has(tag)) return true;

    const cs = getComputedStyle(el);
    // Full-screen overlays or backgrounds
    if (cs.position === "fixed" && (cs.inset === "0px" || (cs.top === "0px" && cs.left === "0px"))) return true;

    return false;
  };

  // Check if element has DIRECT text (not just in children)
  const hasDirectText = (el) => {
    if (!el) return false;
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && (node.nodeValue || "").trim().length > 0) {
        return true;
      }
    }
    return false;
  };

  // Score an element for how likely it is to be the target text
  const scoreTextElement = (el, x, y) => {
    if (!el || !isTextual(el)) return -1;

    let score = 0;

    // Has direct text content (not just nested)
    if (hasDirectText(el)) score += 50;
    else if (hasAnyText(el)) score += 10;
    else return -1;

    // Element bounds contain the click point
    try {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        score += 30;
      }
    } catch { }

    // Prefer smaller/more specific elements
    try {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > 0 && area < 50000) score += 20;
      else if (area < 200000) score += 10;
    } catch { }

    // Text-centric tags
    const tag = el.tagName?.toLowerCase();
    const textTags = new Set(["p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "a", "li", "td", "th", "label", "button", "strong", "em", "b", "i"]);
    if (textTags.has(tag)) score += 15;

    // Skip likely overlays
    if (isOverlayElement(el)) return -1;

    return score;
  };

  // Enhanced findTextElement with multi-strategy fallback chain
  const findTextElement = (start, x, y) => {
    usedForcedMode = false;

    // Strategy 1: Standard ascent from start element (if it has direct text)
    let el = start;
    for (let i = 0; i < 8 && el; i++) {
      if (isTextual(el) && hasDirectText(el) && !isOverlayElement(el)) return el;
      el = ascend(el);
    }

    // Strategy 2: Caret-based detection (most accurate for text)
    if (typeof x === "number" && typeof y === "number") {
      const caretEl = getElementFromCaret(x, y);
      if (caretEl && isTextual(caretEl) && !isOverlayElement(caretEl)) {
        usedForcedMode = true;
        return caretEl;
      }
    }

    // Strategy 3: Score ALL elements at point, pick the best one
    if (typeof x === "number" && typeof y === "number" && document.elementsFromPoint) {
      const elements = document.elementsFromPoint(x, y);
      let bestEl = null;
      let bestScore = -1;

      for (const candidate of elements) {
        // Skip our own UI elements
        if (candidate.id?.startsWith("fs-") || candidate.closest?.("#fs-exit")) continue;
        if (candidate === document.body || candidate === document.documentElement) continue;

        const score = scoreTextElement(candidate, x, y);
        if (score > bestScore) {
          bestScore = score;
          bestEl = candidate;
        }
      }

      if (bestEl && bestScore > 0) {
        usedForcedMode = true;
        return bestEl;
      }
    }

    // Strategy 4: Deep Shadow DOM pierce
    if (typeof x === "number" && typeof y === "number") {
      const deepEl = deepElementFromPoint(x, y);
      if (deepEl && isTextual(deepEl) && hasAnyText(deepEl) && !isOverlayElement(deepEl)) {
        usedForcedMode = true;
        return deepEl;
      }

      // Ascend from deep element
      el = deepEl;
      for (let i = 0; i < 8 && el; i++) {
        if (isTextual(el) && hasDirectText(el) && !isOverlayElement(el)) {
          usedForcedMode = true;
          return el;
        }
        el = ascend(el);
      }
    }

    // Strategy 5: Find closest visible text element to click point
    if (typeof x === "number" && typeof y === "number") {
      const allTextElements = document.querySelectorAll("p, span, h1, h2, h3, h4, h5, h6, a, li, button, label");
      let closestEl = null;
      let closestDist = Infinity;

      for (const candidate of allTextElements) {
        if (!isTextual(candidate) || !hasAnyText(candidate)) continue;
        try {
          const rect = candidate.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const dist = Math.hypot(x - centerX, y - centerY);
          if (dist < closestDist && dist < 200) { // Within 200px radius
            closestDist = dist;
            closestEl = candidate;
          }
        } catch { }
      }

      if (closestEl) {
        usedForcedMode = true;
        return closestEl;
      }
    }

    // Fallback: return original start with basic text check
    el = start;
    for (let i = 0; i < 8 && el; i++) {
      if (isTextual(el) && hasAnyText(el)) return el;
      el = ascend(el);
    }

    return start;
  };

  // ========== ULTRA-AGGRESSIVE FONT DETECTION ==========
  // These strategies target sites like Shopify, Framer, Webflow that use
  // advanced font loading techniques that bypass normal getComputedStyle detection.

  // Strategy A: Use document.fonts API to get all loaded fonts
  const getLoadedWebFonts = () => {
    const fonts = [];
    try {
      if (document.fonts && typeof document.fonts.forEach === "function") {
        document.fonts.forEach((fontFace) => {
          if (fontFace.status === "loaded" && fontFace.family) {
            const family = fontFace.family.replace(/^["']|["']$/g, "").trim();
            if (family && !genericSet.has(family.toLowerCase())) {
              fonts.push({
                family,
                weight: fontFace.weight || "normal",
                style: fontFace.style || "normal"
              });
            }
          }
        });
      }
    } catch (e) { /* ignore */ }
    return fonts;
  };

  // Strategy B: Parse @font-face rules from all stylesheets
  const getFontFaceRules = () => {
    const fonts = new Map(); // family -> { weights: Set, styles: Set }
    try {
      for (const sheet of document.styleSheets) {
        try {
          // Skip cross-origin stylesheets we can't access
          if (!sheet.cssRules) continue;
          for (const rule of sheet.cssRules) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
              const style = rule.style;
              let family = style.getPropertyValue("font-family").trim();
              family = family.replace(/^["']|["']$/g, "").trim();
              if (!family || genericSet.has(family.toLowerCase())) continue;

              const weight = style.getPropertyValue("font-weight") || "400";
              const fontStyle = style.getPropertyValue("font-style") || "normal";

              if (!fonts.has(family)) {
                fonts.set(family, { weights: new Set(), styles: new Set() });
              }
              fonts.get(family).weights.add(weight);
              fonts.get(family).styles.add(fontStyle);
            }
          }
        } catch (e) {
          // Cross-origin stylesheet, skip
        }
      }
    } catch (e) { /* ignore */ }
    return fonts;
  };

  // Strategy C: Check if any custom font from @font-face actually renders differently
  const findActualRenderedFont = (el, declaredFamilies) => {
    if (!el) return null;

    // Get all @font-face fonts
    const fontFaceMap = getFontFaceRules();
    const loadedFonts = getLoadedWebFonts();

    // Combine sources
    const customFonts = new Set([
      ...fontFaceMap.keys(),
      ...loadedFonts.map(f => f.family)
    ]);

    // Test each custom font to see if it actually renders
    for (const fontName of customFonts) {
      if (isFontAvailable(fontName)) {
        // Check if this font is in the declared families
        const declaredLower = declaredFamilies.map(f => f.toLowerCase());
        if (declaredLower.includes(fontName.toLowerCase())) {
          return fontName;
        }
      }
    }

    // Fallback: return first available custom font
    for (const fontName of customFonts) {
      if (isFontAvailable(fontName)) {
        return fontName;
      }
    }

    return null;
  };

  // Strategy D: Nuclear option - scan document for inline style font-family declarations
  const findInlineStyleFonts = (el) => {
    if (!el) return [];
    const fonts = [];

    // Check the element and all ancestors for inline font-family
    let node = el;
    for (let i = 0; i < 10 && node; i++) {
      try {
        if (node.nodeType === 1 && node.style?.fontFamily) {
          const families = parseFamilies(node.style.fontFamily);
          fonts.push(...families);
        }
      } catch (e) { /* ignore */ }
      node = ascend(node);
    }

    return fonts;
  };

  // Strategy E: Check CSS custom properties (CSS variables) for font definitions
  const findCSSVariableFonts = (el) => {
    const fonts = [];
    try {
      const cs = getComputedStyle(el);
      // Common CSS variable patterns for fonts
      const varPatterns = [
        "--font-family", "--heading-font", "--body-font", "--primary-font",
        "--font-sans", "--font-serif", "--font-mono", "--typography-font",
        "--font-main", "--font-base", "--text-font", "--ff-primary"
      ];

      for (const varName of varPatterns) {
        const value = cs.getPropertyValue(varName).trim();
        if (value) {
          fonts.push(...parseFamilies(value));
        }
      }
    } catch (e) { /* ignore */ }
    return fonts;
  };

  // ========== PAGE-WIDE FONT SCANNER ==========
  // Scans the entire page for all fonts and groups them by usage context
  const scanPageFonts = () => {
    const fontUsage = new Map(); // fontName -> { contexts: Set, weights: Set, styles: Set }

    const addFont = (fontName, context, weight = "400", style = "normal") => {
      if (!fontName) return;
      const clean = fontName.trim().replace(/^['"]|['"]$/g, "");
      if (!clean || genericSet.has(clean.toLowerCase()) || ALIAS_SET.has(clean.toLowerCase())) return;

      if (!fontUsage.has(clean)) {
        fontUsage.set(clean, { contexts: new Set(), weights: new Set(), styles: new Set() });
      }
      const entry = fontUsage.get(clean);
      if (context) entry.contexts.add(context);
      if (weight) entry.weights.add(String(weight));
      if (style) entry.styles.add(style);
    };

    // Strategy 1: Get all @font-face rules
    try {
      for (const sheet of document.styleSheets) {
        try {
          if (!sheet.cssRules) continue;
          for (const rule of sheet.cssRules) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
              const s = rule.style;
              const family = s.getPropertyValue("font-family");
              const weight = s.getPropertyValue("font-weight") || "400";
              const style = s.getPropertyValue("font-style") || "normal";
              addFont(family, "@font-face", weight, style);
            }
          }
        } catch (e) { /* cross-origin */ }
      }
    } catch (e) { /* ignore */ }

    // Strategy 2: Get all loaded fonts from document.fonts
    try {
      if (document.fonts && typeof document.fonts.forEach === "function") {
        document.fonts.forEach((fontFace) => {
          if (fontFace.status === "loaded") {
            addFont(fontFace.family, "loaded", fontFace.weight, fontFace.style);
          }
        });
      }
    } catch (e) { /* ignore */ }

    // Strategy 3: Scan actual DOM elements for font usage with context
    const contextSelectors = {
      "Heading": "h1, h2, h3, h4, h5, h6",
      "Body": "p, article, section, main, .content, .text, [class*='body'], [class*='paragraph']",
      "Nav": "nav, header, .nav, .navbar, .menu, [class*='nav']",
      "Link": "a",
      "Button": "button, .btn, [class*='button'], input[type='submit']",
      "Form": "input, textarea, select, label, .form",
      "Footer": "footer, .footer",
      "Code": "code, pre, .code, [class*='mono']",
      "List": "li, ul, ol",
      "Table": "table, th, td"
    };

    for (const [context, selector] of Object.entries(contextSelectors)) {
      try {
        const elements = document.querySelectorAll(selector);
        const sampled = Array.from(elements).slice(0, 10); // Sample first 10 to avoid perf issues
        for (const el of sampled) {
          try {
            const cs = getComputedStyle(el);
            const families = parseFamilies(cs.fontFamily);
            for (const fam of families) {
              if (!genericSet.has(fam.toLowerCase())) {
                addFont(fam, context, cs.fontWeight, cs.fontStyle);
                break; // Only count first (primary) font
              }
            }
          } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
    }

    // Strategy 4: Check root styles for base fonts
    try {
      const rootCs = getComputedStyle(document.documentElement);
      const bodyCs = getComputedStyle(document.body);

      for (const fam of parseFamilies(rootCs.fontFamily)) {
        addFont(fam, "Default", rootCs.fontWeight, rootCs.fontStyle);
      }
      for (const fam of parseFamilies(bodyCs.fontFamily)) {
        addFont(fam, "Default", bodyCs.fontWeight, bodyCs.fontStyle);
      }
    } catch (e) { /* ignore */ }

    // Convert to sorted array (most contexts first = more important)
    const result = [];
    for (const [fontName, data] of fontUsage) {
      // Verify font is actually available
      let isLoaded = false;
      try {
        if (document.fonts && typeof document.fonts.check === "function") {
          isLoaded = document.fonts.check(`16px "${fontName}"`);
        }
      } catch (e) { /* ignore */ }

      result.push({
        name: fontName,
        contexts: Array.from(data.contexts),
        weights: Array.from(data.weights),
        styles: Array.from(data.styles),
        isLoaded
      });
    }

    // Sort: loaded fonts first, then by number of contexts
    result.sort((a, b) => {
      if (a.isLoaded !== b.isLoaded) return b.isLoaded ? 1 : -1;
      return b.contexts.length - a.contexts.length;
    });

    return result;
  };


  // Font Helpers
  const genericSet = new Set([
    "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded",
    "sans-serif", "serif", "monospace", "cursive", "fantasy", "emoji", "math", "fangsong"
  ]);
  const ALIAS_SET = new Set(["-apple-system", "blinkmacsystemfont"]);

  const parseFamilies = (fontFamilyStr) =>
    String(fontFamilyStr || "")
      .split(",")
      .map(s => s.trim().replace(/^['\"]|['\"]$/g, ""))
      .filter(Boolean);

  // Font Detection
  const fontAvailCache = new Map();
  function measure(text, fontSizePx, family, fallback) {
    const span = document.createElement("span");
    span.textContent = text;
    Object.assign(span.style, {
      position: "absolute", left: "-9999px", top: "0",
      fontSize: fontSizePx + "px", fontWeight: "400", fontStyle: "normal",
      letterSpacing: "0", lineHeight: "normal", whiteSpace: "nowrap",
      textRendering: "optimizeLegibility", fontFeatureSettings: "normal",
      fontFamily: `"${family}", ${fallback}`
    });
    document.documentElement.appendChild(span);
    const out = [span.offsetWidth, span.offsetHeight];
    span.remove();
    return out;
  }
  function canvasAvailable(family) {
    try {
      const WIDE = "MW@#Il1Oo0WWMWMWmmmmmmmmmmmm", NARROW = ".,;:iIl!|[]()ftjrxn";
      const sizes = [32, 48], fbs = ["serif", "sans-serif", "monospace"];
      const base = {};
      for (const s of sizes) {
        base[s] = {};
        for (const f of fbs) {
          base[s][f] = { W: measure(WIDE, s, "_fs_fake_", f), N: measure(NARROW, s, "_fs_fake_", f) };
        }
      }
      const differsAll = (getter) =>
        fbs.every(f => sizes.every(sz => {
          const d = getter(sz, f), r = base[sz][f];
          return (d[0] !== r.W[0] || d[1] !== r.W[1]) || (d[0] !== r.N[0] || d[1] !== r.N[1]);
        }));
      const gW = (sz, f) => measure(WIDE, sz, family, f);
      const gN = (sz, f) => measure(NARROW, sz, family, f);
      return differsAll(gW) || differsAll(gN);
    } catch { return false; }
  }
  function isFontAvailable(nameRaw) {
    if (!nameRaw) return false;
    const name = String(nameRaw).trim().replace(/^['"]|['"]$/g, "");
    const low = name.toLowerCase();
    if (fontAvailCache.has(low)) return fontAvailCache.get(low);
    if (genericSet.has(low)) { fontAvailCache.set(low, true); return true; }

    // METHOD 1: Use document.fonts.check() API (most reliable for web fonts)
    // This directly checks if the browser has loaded the font
    try {
      if (document.fonts && typeof document.fonts.check === "function") {
        // Check at multiple sizes to be sure
        const isLoaded = document.fonts.check(`16px "${name}"`) ||
          document.fonts.check(`12px "${name}"`) ||
          document.fonts.check(`bold 16px "${name}"`);
        if (isLoaded) {
          fontAvailCache.set(low, true);
          return true;
        }
      }
    } catch (e) { /* ignore */ }

    // METHOD 2: Check if the font exists in document.fonts collection
    try {
      if (document.fonts && typeof document.fonts.forEach === "function") {
        let found = false;
        document.fonts.forEach((fontFace) => {
          if (fontFace.family.replace(/^['"]|['"]$/g, "").toLowerCase() === low) {
            found = true;
          }
        });
        if (found) {
          fontAvailCache.set(low, true);
          return true;
        }
      }
    } catch (e) { /* ignore */ }

    // METHOD 3: Canvas-based measurement (fallback)
    const ok = canvasAvailable(name);
    if (ok) {
      fontAvailCache.set(low, true);
      return true;
    }

    // METHOD 4: Known system fonts (platform-specific)
    const ua = navigator.userAgent || "";
    const isWin = /Windows/.test(ua);
    const isMac = /Macintosh|Mac OS X/.test(ua);
    const isLinux = /Linux/.test(ua);

    let allowed = [];
    if (isWin) allowed = ["segoe ui", "segoe ui variable", "arial", "tahoma", "verdana", "times new roman", "courier new"];
    else if (isMac) allowed = ["sf pro", "sf pro text", "helvetica neue", "helvetica", "arial", "times new roman", "courier new"];
    else if (isLinux) allowed = ["ubuntu", "cantarell", "dejavu sans", "noto sans", "liberation sans", "arial"];

    if (allowed.includes(low)) {
      fontAvailCache.set(low, true);
      return true;
    }

    fontAvailCache.set(low, false);
    return false;
  }
  function metricsEqual(a, b) {
    const text = "MW@#Il1Oo0mmmmWWW";
    const sz = 40;
    const fbs = ["serif", "sans-serif", "monospace"];
    return fbs.every(fb => {
      const da = measure(text, sz, a, fb);
      const db = measure(text, sz, b, fb);
      return da[0] === db[0] && da[1] === db[1];
    });
  }
  function findMatchingPlatformFont(font) {
    const ua = navigator.userAgent || "";
    const isMac = /Macintosh|Mac OS X/.test(ua);
    const isWin = /Windows/.test(ua);
    let candidates = [];
    if (isWin) candidates = ["Segoe UI Variable", "Segoe UI", "Arial", "Tahoma", "Verdana", "Times New Roman", "Courier New"];
    else if (isMac) candidates = ["SF Pro Text", "SF Pro Display", "Helvetica Neue", "Helvetica", "Arial", "Times New Roman", "Courier New"];
    else candidates = ["Ubuntu", "Cantarell", "DejaVu Sans", "Noto Sans", "Liberation Sans", "Arial"];

    for (const c of candidates) {
      if (isFontAvailable(c) && metricsEqual(font, c)) return c;
    }
    return null;
  }
  function isSystemFallback(font, systemFont) {
    // Check if 'font' falls back to 'systemFont' by comparing:
    // 1. font-family: "font", "systemFont"
    // 2. font-family: "systemFont", "sans-serif"
    // If they are identical, then 'font' is missing and falling back to 'systemFont'.
    const text = "MW@#Il1Oo0mmmmWWW";
    const sz = 48; // Use a large size for better precision
    const d1 = measure(text, sz, font, systemFont);
    const d2 = measure(text, sz, systemFont, "sans-serif");
    return d1[0] === d2[0] && d1[1] === d2[1];
  }

  function mapAliasToPlatformFont(alias) {
    const match = findMatchingPlatformFont(alias);
    if (match) return match;
    const ua = navigator.userAgent || "";
    return /Windows/.test(ua) ? "Segoe UI" : (/Macintosh|Mac OS X/.test(ua) ? "SF Pro" : "system-ui");
  }

  function getSystemFonts() {
    const ua = navigator.userAgent || "";
    if (/Windows/.test(ua)) return ["Segoe UI Variable", "Segoe UI", "Arial", "Tahoma", "Verdana"];
    if (/Macintosh|Mac OS X/.test(ua)) return ["SF Pro Text", "SF Pro Display", "Helvetica Neue", "Helvetica", "Arial"];
    if (/Linux/.test(ua)) return ["Ubuntu", "Cantarell", "DejaVu Sans", "Noto Sans", "Arial"];
    return ["Arial", "sans-serif"];
  }

  // resolver: pick first real available font; alias used internally only (not displayed)
  // Enhanced with ultra-aggressive fallback chain for modern sites (Shopify, Framer, etc.)
  const resolveFamily = (startEl) => {
    const seen = new Set();
    let firstAlias = null;
    let firstGeneric = null;
    let chosen = null;
    const allDeclaredFamilies = [];

    const scanList = (families) => {
      for (const raw of families) {
        const name = raw.trim().replace(/^['"]|['"]$/g, "");
        if (!name) continue;
        allDeclaredFamilies.push(name);
        const low = name.toLowerCase();
        if (seen.has(low)) continue;
        seen.add(low);
        if (ALIAS_SET.has(low)) { if (!firstAlias) firstAlias = name; continue; }
        if (genericSet.has(low)) { if (!firstGeneric) firstGeneric = name; continue; }
        if (!chosen && isFontAvailable(name)) { chosen = name; }
      }
    };

    // Stage 1: Standard getComputedStyle traversal
    let node = startEl;
    for (let i = 0; i < 8 && node; i++) {
      try {
        if (node.nodeType === 1) {
          scanList(parseFamilies(getComputedStyle(node).fontFamily));
        }
      } catch { }
      node = ascend(node);
    }
    try { scanList(parseFamilies(getComputedStyle(document.body).fontFamily)); } catch { }
    try { scanList(parseFamilies(getComputedStyle(document.documentElement).fontFamily)); } catch { }

    // Stage 2: Check CSS variables (common in modern sites)
    if (!chosen) {
      const varFonts = findCSSVariableFonts(startEl);
      scanList(varFonts);
    }

    // Stage 3: Check inline styles
    if (!chosen) {
      const inlineFonts = findInlineStyleFonts(startEl);
      scanList(inlineFonts);
    }

    // Stage 4: Use document.fonts API to find loaded web fonts
    if (!chosen) {
      const loadedFonts = getLoadedWebFonts();
      for (const fontInfo of loadedFonts) {
        const name = fontInfo.family;
        if (!seen.has(name.toLowerCase()) && isFontAvailable(name)) {
          // Only return this font if it's in the declared families OR
          // if we have no other option
          const declaredLower = allDeclaredFamilies.map(f => f.toLowerCase());
          if (declaredLower.includes(name.toLowerCase())) {
            chosen = name;
            break;
          }
        }
      }

      // If still no match but we have loaded fonts, use the first one that matches
      if (!chosen) {
        for (const fontInfo of loadedFonts) {
          if (isFontAvailable(fontInfo.family)) {
            chosen = fontInfo.family;
            usedForcedMode = true;
            break;
          }
        }
      }
    }

    // Stage 5: Parse @font-face rules as nuclear option
    if (!chosen) {
      const fontFaceMap = getFontFaceRules();
      for (const [family] of fontFaceMap) {
        if (isFontAvailable(family)) {
          const declaredLower = allDeclaredFamilies.map(f => f.toLowerCase());
          if (declaredLower.includes(family.toLowerCase())) {
            chosen = family;
            usedForcedMode = true;
            break;
          }
        }
      }

      // Last resort: first available @font-face font
      if (!chosen) {
        for (const [family] of fontFaceMap) {
          if (isFontAvailable(family)) {
            chosen = family;
            usedForcedMode = true;
            break;
          }
        }
      }
    }

    if (chosen) {
      // Skip the aggressive system fallback check if font was confirmed by document.fonts API
      // The document.fonts.check() API is the most reliable - if it says the font is loaded, trust it
      let confirmedByFontsAPI = false;
      try {
        if (document.fonts && typeof document.fonts.check === "function") {
          confirmedByFontsAPI = document.fonts.check(`16px "${chosen}"`) ||
            document.fonts.check(`12px "${chosen}"`);
        }
      } catch (e) { /* ignore */ }

      if (!confirmedByFontsAPI) {
        // Reality Check: Only do this if font wasn't confirmed by document.fonts API
        // Check if chosen font falls back to ANY known system font.
        const sysFonts = getSystemFonts();
        for (const sys of sysFonts) {
          if (chosen.toLowerCase() !== sys.toLowerCase() && isSystemFallback(chosen, sys)) {
            return sys;
          }
        }
      }

      if (chosen.toLowerCase() === "system-ui") return mapAliasToPlatformFont("system-ui");
      return chosen;
    }
    if (firstAlias) return mapAliasToPlatformFont(firstAlias);
    return firstGeneric || "system-ui";
  };

  // Color Utils
  const resolveColor = (color) => {
    // Canvas "Washing" technique:
    // Draw the color on a 1x1 canvas and read back the RGBA values.
    // This handles ALL valid CSS colors (hex, rgb, hsl, lab, oklch, named colors, etc.)
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a };
  };

  const colorToHex = (colorStr) => {
    const { r, g, b, a } = resolveColor(colorStr);
    const to2 = (n) => n.toString(16).padStart(2, "0").toUpperCase();
    if (a < 255) return `#${to2(r)}${to2(g)}${to2(b)}${to2(a)}`;
    return `#${to2(r)}${to2(g)}${to2(b)}`;
  };
  const parseHexToRgb = (hex) => {
    hex = String(hex || "").trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
    const v = hex.slice(1);
    let r, g, b;
    if (v.length === 3) { r = parseInt(v[0] + v[0], 16); g = parseInt(v[1] + v[1], 16); b = parseInt(v[2] + v[2], 16); }
    else { r = parseInt(v.slice(0, 2), 16); g = parseInt(v.slice(2, 4), 16); b = parseInt(v.slice(4, 6), 16); }
    return [r, g, b];
  };
  const rgbToHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  };

  // Viewport Utils
  const getViewport = () => {
    const g = (typeof globalThis !== "undefined" ? globalThis : self);
    const vv = g.visualViewport;
    const vw = (vv && vv.width) || g.innerWidth || document.documentElement.clientWidth || 1024;
    const vh = (vv && vv.height) || g.innerHeight || document.documentElement.clientHeight || 768;
    const sx = (vv && vv.pageLeft) || g.scrollX || document.documentElement.scrollLeft || 0;
    const sy = (vv && vv.pageTop) || g.scrollY || document.documentElement.scrollTop || 0;
    return { vw, vh, sx, sy };
  };

  // Highlight
  const showHighlight = (el) => {
    if (!highlightEl) {
      highlightEl = document.createElement("div");
      highlightEl.id = "fs-highlight";
      Object.assign(highlightEl.style, {
        position: "absolute", zIndex: "2147483646",
        border: "2px solid rgba(99,102,241,.9)", borderRadius: "8px",
        boxShadow: "0 0 0 3px rgba(99,102,241,.25)",
        pointerEvents: "none"
      });
      document.documentElement.appendChild(highlightEl);
    }
    const r = el.getBoundingClientRect();
    const { sx, sy } = getViewport();
    highlightEl.style.left = `${r.left + sx - 4}px`;
    highlightEl.style.top = `${r.top + sy - 4}px`;
    highlightEl.style.width = `${r.width + 8}px`;
    highlightEl.style.height = `${r.height + 8}px`;
    setTimeout(() => { highlightEl?.remove(); highlightEl = null; }, 1000);
  };

  // Exit UI
  const showExit = () => {
    exitEl = document.createElement("div");
    exitEl.id = "fs-exit";

    const dot = document.createElement("span");
    Object.assign(dot.style, {
      width: "6px", height: "6px", borderRadius: "50%",
      background: "#4ade80", boxShadow: "0 0 8px rgba(74,222,128,0.6)"
    });

    const txt = document.createElement("span");
    txt.textContent = "FontSeek Active";
    Object.assign(txt.style, { fontSize: "12px", fontWeight: "600", letterSpacing: "0.02em", color: "rgba(255,255,255,0.9)" });

    // Show All Fonts button
    const allFontsBtn = document.createElement("button");
    allFontsBtn.type = "button";
    allFontsBtn.textContent = "All Fonts";
    Object.assign(allFontsBtn.style, {
      all: "unset", cursor: "pointer", fontSize: "11px", fontWeight: "600",
      padding: "4px 10px", borderRadius: "6px",
      background: "rgba(99,102,241,0.3)", color: "#a5b4fc",
      transition: "background 0.2s"
    });
    allFontsBtn.addEventListener("mouseenter", () => allFontsBtn.style.background = "rgba(99,102,241,0.5)");
    allFontsBtn.addEventListener("mouseleave", () => allFontsBtn.style.background = "rgba(99,102,241,0.3)");
    allFontsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showAllFontsPopup(e.clientX, e.clientY);
    });

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Exit";
    Object.assign(btn.style, {
      all: "unset", cursor: "pointer", fontSize: "11px", fontWeight: "600",
      padding: "4px 10px", borderRadius: "6px",
      background: "rgba(255,255,255,0.1)", color: "#fff",
      transition: "background 0.2s"
    });
    btn.addEventListener("mouseenter", () => btn.style.background = "rgba(255,255,255,0.2)");
    btn.addEventListener("mouseleave", () => btn.style.background = "rgba(255,255,255,0.1)");
    btn.addEventListener("click", stop);

    exitEl.append(dot, txt, allFontsBtn, btn);

    Object.assign(exitEl.style, {
      position: "fixed", top: "20px", right: "20px", zIndex: "2147483647",
      display: "flex", alignItems: "center", gap: "12px",
      padding: "8px 10px 8px 14px",
      background: "rgba(15, 15, 15, 0.90)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "99px",
      backdropFilter: "blur(12px)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      fontFamily: "system-ui, -apple-system, sans-serif",
      opacity: "0", transform: "translateY(-10px)", transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
    });

    document.documentElement.appendChild(exitEl);
    // Animate in
    requestAnimationFrame(() => {
      exitEl.style.opacity = "1";
      exitEl.style.transform = "translateY(0)";
    });
  };

  // Weight Utils
  const WEIGHT_NAMES = { 100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semi Bold", 700: "Bold", 800: "Extra Bold", 900: "Black" };
  const normalizeWeightNumber = (w) => {
    if (typeof w === "string") {
      const s = w.toLowerCase();
      if (s === "normal") return 400;
      if (s === "bold") return 700;
      const n = parseInt(s, 10);
      if (!isNaN(n)) return Math.min(900, Math.max(100, n));
      return 400;
    }
    if (typeof w === "number") return Math.min(900, Math.max(100, w));
    return 400;
  };
  const bucketWeight = (n) => Math.min(900, Math.max(100, Math.round(n / 100) * 100));
  const formatWeight = (w) => {
    const n = normalizeWeightNumber(w);
    const b = bucketWeight(n);
    const name = WEIGHT_NAMES[b] || "Regular";
    return `${n} — ${name}`;
  };

  // popup (shadow)
  const ensurePopup = () => {
    if (popupHost && popupRoot && rowsEl) return;
    popupHost = document.createElement("div");
    Object.assign(popupHost.style, { position: "absolute", zIndex: "2147483647", inset: "0 auto auto 0" });
    popupRoot = popupHost.attachShadow({ mode: "open" });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host{ all: initial; }
      *{ box-sizing:border-box; }
      .card{
        width: 380px;
        background: rgba(15, 15, 15, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0,0,0,0.4);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        overflow: hidden; color: #fff;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex; flex-direction: column;
      }
      
      /* Header Section */
      .header {
        padding: 20px 24px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        display: flex; flex-direction: column; gap: 8px;
        background: linear-gradient(to bottom, rgba(255,255,255,0.03), transparent);
      }
      .top-row { display: flex; justify-content: space-between; align-items: flex-start; }
      .font-name {
        font-size: 22px; font-weight: 700; line-height: 1.2;
        color: #fff; letter-spacing: -0.01em;
        margin-right: 12px;
      }
      .actions { display: flex; gap: 8px; }
      
      /* Grid Layout for Metrics */
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        background: rgba(255,255,255,0.06); /* Grid lines */
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .cell {
        background: rgba(15, 15, 15, 0.95); /* Cell bg */
        padding: 14px 20px;
        display: flex; flex-direction: column; gap: 4px;
      }
      .cell label {
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
        color: rgba(255,255,255,0.5); font-weight: 600;
        display: block;
      }
      .cell .value {
        font-size: 13px; color: #f0f0f0; font-family: "SF Mono", "Roboto Mono", monospace;
        font-weight: 500;
      }
      
      /* Color Section */
      .color-section {
        padding: 12px 20px;
        display: flex; align-items: center; justify-content: space-between;
        background: rgba(0,0,0,0.2);
        border-top: 1px solid rgba(255,255,255,0.06);
      }
      .color-identity {
        display: flex; align-items: center; gap: 12px;
      }
      .mini-swatch {
        width: 24px; height: 24px; border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.2);
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }
      .color-value {
        font-size: 13px; font-family: "SF Mono", "Roboto Mono", monospace;
        color: #fff; font-weight: 600; letter-spacing: 0.02em;
      }
      
      .copy-actions {
        display: flex; gap: 6px;
      }
      .copy-btn {
        all: unset;
        font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.6);
        background: rgba(255,255,255,0.06);
        padding: 4px 8px; border-radius: 4px;
        cursor: pointer; transition: all 0.15s;
        text-transform: uppercase; letter-spacing: 0.05em;
      }
      .copy-btn:hover {
        background: rgba(255,255,255,0.15);
        color: #fff;
        transform: translateY(-1px);
      }
      .copy-btn:active { transform: translateY(0); }

      /* Buttons */
      .iconbtn {
        all: unset; display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
        color: rgba(255,255,255,0.7); transition: all 0.15s;
        background: rgba(255,255,255,0.05);
      }
      .iconbtn:hover { background: rgba(255,255,255,0.15); color: #fff; }
      .iconbtn svg { width: 16px; height: 16px; }
      
      /* Tooltip & Toast */
      .tip {
        position:fixed; z-index:10; padding:6px 10px;
        background: #000; color:#fff; border:1px solid rgba(255,255,255,0.2);
        border-radius:6px; font-size: 11px; font-weight: 500;
        pointer-events:none; opacity:0; transform: translateY(4px); transition: .15s;
      }
      .tip.show{ opacity:1; transform: translateY(0); }
      .toast{ position:fixed; z-index:11; padding:8px 12px; background:#22c55e; color:#fff; border-radius:20px; font-size:12px; font-weight:600; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
      
      /* Forced Mode Badge */
      .mode-badge {
        font-size: 9px;
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: #000;
        padding: 3px 7px;
        border-radius: 4px;
        margin-left: 10px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        vertical-align: middle;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }
      
      /* All Fonts Popup Styles */
      .all-fonts-card {
        width: 420px;
        max-height: 500px;
        background: rgba(15, 15, 15, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(20px) saturate(180%);
        overflow: hidden; color: #fff;
        font-family: system-ui, -apple-system, sans-serif;
        display: flex; flex-direction: column;
      }
      .all-fonts-header {
        padding: 20px 24px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        display: flex; justify-content: space-between; align-items: center;
        background: linear-gradient(to bottom, rgba(255,255,255,0.03), transparent);
      }
      .all-fonts-title {
        font-size: 18px; font-weight: 700; color: #fff;
        display: flex; align-items: center; gap: 10px;
      }
      .all-fonts-count {
        font-size: 11px; background: rgba(99,102,241,0.3); color: #a5b4fc;
        padding: 3px 8px; border-radius: 12px; font-weight: 600;
      }
      .all-fonts-list {
        flex: 1; overflow-y: auto; padding: 8px 0;
        max-height: 380px;
      }
      .all-fonts-list::-webkit-scrollbar { width: 8px; }
      .all-fonts-list::-webkit-scrollbar-track { background: transparent; }
      .all-fonts-list::-webkit-scrollbar-thumb { 
        background: rgba(255,255,255,0.15); border-radius: 4px;
      }
      .all-fonts-list::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
      
      .font-item {
        padding: 12px 24px;
        display: flex; flex-direction: column; gap: 6px;
        border-bottom: 1px solid rgba(255,255,255,0.04);
        transition: background 0.15s;
        cursor: pointer;
      }
      .font-item:hover { background: rgba(255,255,255,0.05); }
      .font-item:last-child { border-bottom: none; }
      
      .font-item-name {
        font-size: 15px; font-weight: 600; color: #fff;
        display: flex; align-items: center; gap: 8px;
      }
      .font-item-loaded {
        width: 6px; height: 6px; border-radius: 50%;
        background: #4ade80; box-shadow: 0 0 6px rgba(74,222,128,0.5);
      }
      .font-item-not-loaded {
        width: 6px; height: 6px; border-radius: 50%;
        background: #f59e0b; box-shadow: 0 0 6px rgba(245,158,11,0.5);
      }
      .font-item-contexts {
        display: flex; flex-wrap: wrap; gap: 4px;
      }
      .context-tag {
        font-size: 10px; padding: 2px 6px; border-radius: 4px;
        background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6);
        font-weight: 500;
      }
      .font-item-weights {
        font-size: 11px; color: rgba(255,255,255,0.4);
        font-family: "SF Mono", "Roboto Mono", monospace;
      }
      
      .empty-state {
        padding: 40px 24px;
        text-align: center; color: rgba(255,255,255,0.5);
      }
      .empty-state-icon { font-size: 32px; margin-bottom: 12px; }
      .empty-state-text { font-size: 14px; }
    `);
    popupRoot.adoptedStyleSheets = [sheet];

    const card = document.createElement("div");
    card.className = "card";

    // Header
    const header = document.createElement("div");
    header.className = "header";

    const topRow = document.createElement("div");
    topRow.className = "top-row";

    const fontName = document.createElement("div");
    fontName.className = "font-name";
    fontName.id = "fs-font-name";
    fontName.textContent = "Font Name";

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.id = "fs-actions"; // Container for search button

    const closeBtn = document.createElement("button");
    closeBtn.className = "iconbtn";
    closeBtn.setAttribute("aria-label", "Close");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M18 6L6 18M6 6l12 12");

    svg.appendChild(path);
    closeBtn.appendChild(svg);
    closeBtn.addEventListener("click", closePopup);

    actions.appendChild(closeBtn);
    topRow.appendChild(fontName);
    topRow.appendChild(actions);
    header.appendChild(topRow);

    // Grid Container
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.id = "fs-grid";

    // Color Section
    const colorSec = document.createElement("div");
    colorSec.className = "color-section";
    colorSec.id = "fs-color-sec";

    card.appendChild(header);
    card.appendChild(grid);
    card.appendChild(colorSec);

    popupRoot.appendChild(card);

    popupCard = card;
    // Expose elements for update
    rowsEl = {
      name: fontName,
      actions: actions,
      grid: grid,
      color: colorSec
    };

    document.documentElement.appendChild(popupHost);
    popupHost.style.visibility = "hidden";
    popupHost.style.width = "1px";
    popupHost.style.height = "1px";
  };

  const positionPopup = (x, y) => {
    if (!popupHost || !popupCard) return;
    const pad = 12;
    const { vw, vh, sx, sy } = getViewport();
    popupHost.style.visibility = "hidden";
    popupHost.style.width = "auto";
    popupHost.style.height = "auto";
    const rect = popupCard.getBoundingClientRect ? popupCard.getBoundingClientRect() : { width: 480, height: 260 };
    const W = Math.ceil(rect.width) || 420;
    const H = Math.ceil(rect.height) || 220;
    const left = Math.min(x + pad, vw - W - pad) + sx;
    const top = Math.min(y + pad, vh - H - pad) + sy;
    popupHost.style.left = left + "px";
    popupHost.style.top = top + "px";
    popupHost.style.visibility = "visible";
  };

  const closePopup = () => {
    if (popupHost) { popupHost.remove(); popupHost = null; popupRoot = null; popupCard = null; rowsEl = null; }
  };

  // All Fonts Popup - shows all detected fonts on the page
  let allFontsHost = null;

  const closeAllFontsPopup = () => {
    if (allFontsHost) { allFontsHost.remove(); allFontsHost = null; }
    // Restore toolbar visibility
    if (exitEl) exitEl.style.display = 'flex';
  };

  const showAllFontsPopup = (x, y) => {
    try {
      console.log('[FontSeek] showAllFontsPopup called at:', x, y);

      closePopup(); // Close regular popup if open
      closeAllFontsPopup(); // Close any existing all fonts popup

      // Hide toolbar while popup is open to avoid z-index conflict
      if (exitEl) exitEl.style.display = 'none';

      // Scan the page for all fonts
      console.log('[FontSeek] Scanning page fonts...');
      const fonts = scanPageFonts();
      console.log('[FontSeek] Found fonts:', fonts.length, fonts);

      // Create popup host with shadow DOM
      allFontsHost = document.createElement("div");
      allFontsHost.id = "fs-all-fonts-host";
      console.log('[FontSeek] Created allFontsHost element');
      Object.assign(allFontsHost.style, {
        position: "absolute", zIndex: "2147483647", inset: "0 auto auto 0"
      });
      const shadow = allFontsHost.attachShadow({ mode: "open" });

      // CSS string - using style element instead of adoptedStyleSheets for CSP compatibility
      const cssText = `
      /* Premium Glassmorphism & Tactile UI */
      :host { all: initial; display: block; pointer-events: auto; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
      * { box-sizing: border-box; }
      
      .all-fonts-card {
        position: relative;
        pointer-events: auto; /* Ensure clicks are captured */
        top: 0; left: 0;
        width: 420px; max-height: 500px;
        display: flex; flex-direction: column;
        
        /* Glassmorphism Background */
        background: rgba(10, 10, 10, 0.75);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        
        /* Premium Border & Shadow */
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 
          0 24px 48px -12px rgba(0, 0, 0, 0.8),
          0 0 0 1px rgba(255, 255, 255, 0.05) inset; /* Inner bezel */
          
        border-radius: 20px;
        overflow: hidden;
        color: #fff;
        opacity: 0; transform: translateY(10px) scale(0.98);
        animation: card-enter 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
      }
      
      @keyframes card-enter {
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      .all-fonts-header {
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex; justify-content: space-between; align-items: center;
        background: linear-gradient(to bottom, rgba(255,255,255,0.03), transparent);
      }

      .all-fonts-title {
        font-size: 15px; font-weight: 600; color: #fff;
        display: flex; align-items: center; gap: 8px;
        letter-spacing: -0.01em;
      }

      .all-fonts-count {
        font-size: 11px; 
        background: rgba(255, 255, 255, 0.1); 
        color: rgba(255, 255, 255, 0.8);
        padding: 2px 8px; border-radius: 12px; font-weight: 500;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      /* Scrollable List */
      .all-fonts-list {
        flex: 1; overflow-y: auto; padding: 4px 0; max-height: 400px;
        overscroll-behavior: contain;
      }
      .all-fonts-list::-webkit-scrollbar { width: 6px; }
      .all-fonts-list::-webkit-scrollbar-track { background: transparent; }
      .all-fonts-list::-webkit-scrollbar-thumb { 
        background: rgba(255, 255, 255, 0.2); 
        border-radius: 10px; border: 2px solid transparent; background-clip: content-box;
      }
      .all-fonts-list::-webkit-scrollbar-thumb:hover { background-color: rgba(255, 255, 255, 0.3); }

      /* Tactile List Items */
      .font-item {
        padding: 14px 20px;
        display: flex; flex-direction: column; gap: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
        cursor: pointer;
        position: relative;
      }
      .font-item:hover {
        background: rgba(255, 255, 255, 0.06);
      }
      .font-item:active {
        background: rgba(255, 255, 255, 0.04);
      }
      .font-item:last-child { border-bottom: none; }

      .font-item-name {
        font-size: 16px; font-weight: 500; color: #fff;
        display: flex; align-items: center; gap: 10px;
        letter-spacing: -0.01em;
      }

      /* Status Indicators */
      .font-item-loaded, .font-item-not-loaded {
        width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
      }
      .font-item-loaded {
        background: #4ade80; box-shadow: 0 0 8px rgba(74, 222, 128, 0.4);
      }
      .font-item-not-loaded {
        background: #fbbf24; box-shadow: 0 0 8px rgba(251, 191, 36, 0.4);
      }

      /* Context Tags */
      .font-item-contexts { display: flex; flex-wrap: wrap; gap: 6px; }
      .context-tag {
        font-size: 10px; padding: 3px 8px; border-radius: 6px;
        font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em;
        /* Colors injected inline via JS */
        color: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.05); /* Subtle border */
      }
      
      .font-item-weights {
        font-size: 11px; color: rgba(255, 255, 255, 0.4);
        font-family: 'SF Mono', 'Roboto Mono', monospace;
      }

      /* Tactile Close Button */
      .close-btn {
        all: unset; display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; border-radius: 10px; cursor: pointer;
        color: rgba(255, 255, 255, 0.6);
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.05);
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        transition: all 0.2s ease;
      }
      .close-btn:hover { 
        background: rgba(255, 255, 255, 0.1); 
        color: #fff; transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        border-color: rgba(255, 255, 255, 0.1);
      }
      .close-btn:active {
        background: rgba(255, 255, 255, 0.08);
        transform: translateY(0);
        box-shadow: 0 1px 2px rgba(0,0,0,0.1) inset;
      }
      .close-btn svg { width: 16px; height: 16px; }

      /* Empty State */
      .empty-state {
        padding: 60px 24px; text-align: center; color: rgba(255, 255, 255, 0.4);
      }
      .empty-state-icon { font-size: 24px; margin-bottom: 16px; opacity: 0.5; }
      .empty-state-text { font-size: 14px; font-weight: 500; }

      .toast {
        position: fixed; z-index: 100; padding: 10px 16px;
        background: rgba(20, 20, 20, 0.9); color: #fff; 
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        font-size: 13px; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        backdrop-filter: blur(12px);
        opacity: 0; transform: translateY(10px);
        animation: toast-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
      }
      @keyframes toast-in {
        to { opacity: 1; transform: translateY(0); }
      }
    `;

      // Use style element instead of adoptedStyleSheets for better CSP compatibility
      const styleEl = document.createElement('style');
      styleEl.textContent = cssText;
      shadow.appendChild(styleEl);
      console.log('[FontSeek] Styles applied via style element');

      // Build the card
      const card = document.createElement("div");
      card.className = "all-fonts-card";

      // Header
      const header = document.createElement("div");
      header.className = "all-fonts-header";

      const title = document.createElement("div");
      title.className = "all-fonts-title";
      title.textContent = "Page Fonts ";
      const countBadge = document.createElement("span");
      countBadge.className = "all-fonts-count";
      countBadge.textContent = fonts.length;
      title.appendChild(countBadge);

      const closeBtn = document.createElement("button");
      closeBtn.className = "close-btn";
      // Create SVG using createElementNS for CSP compliance
      const closeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      closeSvg.setAttribute("viewBox", "0 0 24 24");
      closeSvg.setAttribute("fill", "none");
      closeSvg.setAttribute("stroke", "currentColor");
      closeSvg.setAttribute("stroke-width", "2.5");
      closeSvg.setAttribute("stroke-linecap", "round");
      const closePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      closePath.setAttribute("d", "M18 6L6 18M6 6l12 12");
      closeSvg.appendChild(closePath);
      closeBtn.appendChild(closeSvg);
      closeBtn.addEventListener("click", closeAllFontsPopup);

      header.appendChild(title);
      header.appendChild(closeBtn);
      card.appendChild(header);

      // List
      const list = document.createElement("div");
      list.className = "all-fonts-list";

      if (fonts.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        const emptyIcon = document.createElement("div");
        emptyIcon.className = "empty-state-icon";
        emptyIcon.textContent = "—";
        const emptyText = document.createElement("div");
        emptyText.className = "empty-state-text";
        emptyText.textContent = "No custom fonts detected";
        empty.appendChild(emptyIcon);
        empty.appendChild(emptyText);
        list.appendChild(empty);
      } else {
        // Show up to 20 fonts to avoid overwhelming UI
        const displayFonts = fonts.slice(0, 20);

        for (const font of displayFonts) {
          const item = document.createElement("div");
          item.className = "font-item";

          // Name row with loaded indicator
          const nameRow = document.createElement("div");
          nameRow.className = "font-item-name";

          const indicator = document.createElement("span");
          indicator.className = font.isLoaded ? "font-item-loaded" : "font-item-not-loaded";
          indicator.title = font.isLoaded ? "Font is loaded" : "Font may not be loaded";

          const nameSpan = document.createElement("span");
          nameSpan.textContent = font.name;
          nameSpan.style.fontFamily = `"${font.name}", system - ui`;

          nameRow.appendChild(indicator);
          nameRow.appendChild(nameSpan);
          item.appendChild(nameRow);

          // Context tags with color-coding
          if (font.contexts.length > 0) {
            const contextRow = document.createElement("div");
            contextRow.className = "font-item-contexts";

            // Color map for different context types
            const contextColors = {
              "Heading": "rgba(96, 165, 250, 0.2)", // blue
              "Body": "rgba(74, 222, 128, 0.2)",    // green
              "Nav": "rgba(168, 85, 247, 0.2)",     // purple
              "Link": "rgba(251, 146, 60, 0.2)",    // orange
              "Button": "rgba(244, 114, 182, 0.2)", // pink
              "Form": "rgba(45, 212, 191, 0.2)",    // teal
              "Footer": "rgba(156, 163, 175, 0.2)", // gray
              "Code": "rgba(251, 191, 36, 0.2)",    // amber
              "List": "rgba(129, 140, 248, 0.2)",   // indigo
              "Table": "rgba(232, 121, 249, 0.2)",  // fuchsia
              "Default": "rgba(255, 255, 255, 0.08)" // default gray
            };

            // Show max 4 contexts
            const displayContexts = font.contexts.slice(0, 4);
            for (const ctx of displayContexts) {
              const tag = document.createElement("span");
              tag.className = "context-tag";
              tag.textContent = ctx;
              // Apply color based on context
              const bgColor = contextColors[ctx] || contextColors["Default"];
              tag.style.background = bgColor;
              contextRow.appendChild(tag);
            }
            if (font.contexts.length > 4) {
              const more = document.createElement("span");
              more.className = "context-tag";
              more.textContent = `+ ${font.contexts.length - 4} `;
              contextRow.appendChild(more);
            }
            item.appendChild(contextRow);
          }

          // Weights
          const weightsFiltered = font.weights.filter(w => w && w !== "undefined");
          if (weightsFiltered.length > 0) {
            const weightsRow = document.createElement("div");
            weightsRow.className = "font-item-weights";
            weightsRow.textContent = `Weights: ${weightsFiltered.join(", ")} `;
            item.appendChild(weightsRow);
          }

          // Click to copy
          item.addEventListener("click", (ev) => {
            navigator.clipboard?.writeText(font.name).then(() => {
              const toast = document.createElement("div");
              toast.className = "toast";
              toast.textContent = `Copied "${font.name}"`;
              toast.style.left = (ev.clientX + 12) + "px";
              toast.style.top = (ev.clientY + 12) + "px";
              shadow.appendChild(toast);
              setTimeout(() => toast.remove(), 1000);
            });
          });

          list.appendChild(item);
        }

        // Show "and more" if there are more fonts
        if (fonts.length > 20) {
          const more = document.createElement("div");
          more.style.cssText = "padding: 12px 24px; text-align: center; color: rgba(255,255,255,0.4); font-size: 12px;";
          more.textContent = `... and ${fonts.length - 20} more fonts`;
          list.appendChild(more);
        }
      }

      card.appendChild(list);
      shadow.appendChild(card);
      document.body.appendChild(allFontsHost);

      // Force visibility with inline styles
      allFontsHost.style.cssText = `
        position: fixed !important;
        z-index: 2147483647 !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      `;

      // Position the popup - use fixed positioning relative to viewport
      const { vw, vh } = getViewport();
      const rect = card.getBoundingClientRect();
      const W = rect.width || 420;
      const H = rect.height || 400;
      const pad = 12;

      // Clamp position to viewport
      let left = Math.min(x + pad, vw - W - pad);
      let top = Math.min(y + pad, vh - H - pad);
      left = Math.max(pad, left);
      top = Math.max(pad, top);

      allFontsHost.style.left = left + "px";
      allFontsHost.style.top = top + "px";

      // Debug: log element info
      console.log('[FontSeek] Host element:', allFontsHost);
      console.log('[FontSeek] Host in DOM:', document.documentElement.contains(allFontsHost));
      console.log('[FontSeek] Host position:', left, top, 'viewport:', vw, vh);
      console.log('[FontSeek] Host computed style:', window.getComputedStyle(allFontsHost).display, window.getComputedStyle(allFontsHost).visibility);
      console.log('[FontSeek] Card rect:', rect);

      console.log('[FontSeek] All Fonts popup displayed successfully');
    } catch (err) {
      console.error('[FontSeek] ERROR in showAllFontsPopup:', err);
      alert('[FontSeek Debug] Error showing fonts: ' + err.message);
    }
  };

  const makeTooltip = (text, e) => {
    if (!popupRoot) return null;
    const t = document.createElement("div");
    t.className = "tip";
    t.textContent = text;
    popupRoot.appendChild(t);

    // Cache dimensions to avoid layout thrashing during mousemove
    const r = t.getBoundingClientRect();
    const w = r.width, h = r.height;
    const vw = innerWidth, vh = innerHeight;

    let rafId = null;

    const update = (ex, ey) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const pad = 10;
        let x = ex + pad, y = ey + pad;
        if (x + w > vw - 6) x = vw - w - 6;
        if (y + h > vh - 6) y = vh - h - 6;
        t.style.left = x + 'px';
        t.style.top = y + 'px';
      });
    };

    // Initial position
    update(e.clientX, e.clientY);

    // animate in
    requestAnimationFrame(() => t.classList.add("show"));

    return {
      update,
      remove: () => {
        if (rafId) cancelAnimationFrame(rafId);
        t.remove();
      }
    };
  };
  const toast = (msg, x, y) => {
    if (!popupRoot) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    popupRoot.appendChild(el);
    el.style.left = (x + 12) + 'px';
    el.style.top = (y + 12) + 'px';
    setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 800);
  };

  // Detect if site is likely blocking font detection
  let isBlockedSiteDetected = null; // cache result
  let failedClickCount = 0;

  const detectBlockedSite = () => {
    if (isBlockedSiteDetected !== null) return isBlockedSiteDetected;

    const checks = [];

    // Check for Shopify
    const hasShopify = !!(
      window.Shopify ||
      document.querySelector('script[src*="shopify"]') ||
      document.querySelector('link[href*="shopify"]') ||
      document.querySelector('meta[name="shopify-checkout-api-token"]')
    );
    if (hasShopify) checks.push('Shopify');

    // Check for React/Next.js with potential blocking
    const hasNextJs = !!(
      document.getElementById('__next') ||
      document.querySelector('script[src*="_next"]') ||
      window.__NEXT_DATA__
    );
    if (hasNextJs) checks.push('Next.js');

    // Check for full-page overlays
    const hasOverlay = !!(
      document.querySelector('div[style*="pointer-events: none"]') ||
      document.querySelector('[class*="overlay"][style*="position: fixed"]')
    );
    if (hasOverlay) checks.push('Overlay');

    // Check for aggressive event listeners on window/document
    // (can't directly check, but known patterns)
    const hostname = window.location.hostname;
    const knownBlockedDomains = [
      'im8health.com', 'aesop.com', 'shopify.com',
      'myshopify.com', 'framer.app'
    ];
    const isKnownBlocked = knownBlockedDomains.some(d => hostname.includes(d));
    if (isKnownBlocked) checks.push('Known-Blocked');

    isBlockedSiteDetected = checks.length > 0;
    if (isBlockedSiteDetected) {
      console.log('[FontSeek] Blocked site detected:', checks.join(', '));
    }
    return isBlockedSiteDetected;
  };

  // Interaction
  const onInteraction = (e) => {
    // Zombie check: if extension is inactive, do nothing (even if listener is still attached)
    if (!window.__FS_ACTIVE__) return;

    // Robust UI detection - also check composedPath for Shadow DOM elements
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const isOurUI = e.target.closest("#fs-exit") ||
      e.target.closest("#fs-highlight") ||
      (popupHost && popupHost.contains(e.target)) ||
      (allFontsHost && allFontsHost.contains(e.target)) ||
      path.some(el => el === popupHost || el === allFontsHost || el === exitEl);

    if (isOurUI) {
      return;
    }

    // Block all interaction with the page
    e.preventDefault();
    e.stopPropagation();

    // Only trigger inspection on click
    if (e.type !== "click") return;


    const base = path && path.length ? path[0] : e.target;

    // Check if click is being intercepted by document-level elements
    const isDocumentLevel = (
      base === document.body ||
      base === document.documentElement ||
      base === document ||
      (base && base.tagName === 'HTML') ||
      (base && base.tagName === 'BODY')
    );

    // Check if target might be an invisible overlay (common in React/Next.js sites)
    const isInvisibleOverlay = base && (
      (base.style && (base.style.opacity === '0' || base.style.visibility === 'hidden' ||
        base.style.pointerEvents === 'none')) ||
      (base.className && typeof base.className === 'string' &&
        (base.className.includes('overlay') || base.className.includes('modal') ||
          base.className.includes('backdrop') || base.className.includes('__next')))
    );

    // Pass coordinates for fallback detection strategies
    let el = findTextElement(base, e.clientX, e.clientY);
    let cs;
    let detectionFailed = false;

    if (el && isTextual(el) && el !== document.body && el !== document.documentElement) {
      cs = getComputedStyle(el);
    } else {
      // Detection failed - element is not textual or is body/html
      el = document.body || document.documentElement;
      cs = getComputedStyle(el);
      detectionFailed = true;
    }

    const familyResolved = resolveFamily(el);

    // Check if font resolution gave us a generic/fallback result
    const isGenericResult = !familyResolved ||
      familyResolved === "system-ui" ||
      familyResolved === "sans-serif" ||
      familyResolved === "serif" ||
      familyResolved === "-apple-system";

    // Check for blocked site on first interaction
    const isBlocked = detectBlockedSite();

    // Track failed clicks for auto-fallback
    const clickFailed = detectionFailed || isDocumentLevel || isInvisibleOverlay;
    if (clickFailed) {
      failedClickCount++;
      console.log('[FontSeek] Failed click count:', failedClickCount);
    } else {
      failedClickCount = 0; // reset on successful detection
    }

    // AUTO-FALLBACK: Trigger if:
    // 1. Detection completely failed (no textual element found by any strategy)
    // 2. Got a generic result while element is body
    // 3. Click was intercepted AND detection failed
    // 4. Target is clearly an invisible overlay
    // 5. Known blocked site detected (show on first click)
    // 6. Multiple consecutive failures (2+)
    const shouldShowAllFonts = (
      detectionFailed ||
      (isGenericResult && el === document.body) ||
      (isDocumentLevel && detectionFailed) ||
      isInvisibleOverlay ||
      (isBlocked && failedClickCount >= 1) ||  // Blocked site: trigger on first failed click
      failedClickCount >= 2                     // Any site: trigger after 2 failed clicks
    );

    if (shouldShowAllFonts) {
      console.log('[FontSeek] Auto-triggering All Fonts mode');
      showAllFontsPopup(e.clientX, e.clientY);
      return;
    }

    const weightText = formatWeight(cs.fontWeight || "-");
    const size = cs.fontSize || "-";
    const letterSpacing = cs.letterSpacing || "-";
    const lineHeight = cs.lineHeight || "-";
    const color = cs.color || "rgb(0,0,0)";
    const colorHex = colorToHex(color);

    ensurePopup();

    // 1. Update Header (Font Name + FORCED badge if applicable)
    rowsEl.name.textContent = familyResolved;
    // Remove any existing forced badge first
    const existingBadge = rowsEl.name.querySelector(".mode-badge");
    if (existingBadge) existingBadge.remove();
    // Add FORCED badge if fallback detection was used
    if (usedForcedMode) {
      const badge = document.createElement("span");
      badge.className = "mode-badge";
      badge.textContent = "FORCED";
      badge.title = "Detected using fallback strategy (Shadow DOM pierce or caret detection)";
      rowsEl.name.appendChild(badge);
    }
    // Apply the font to the header itself for a live preview
    rowsEl.name.style.fontFamily = `"${familyResolved}", system - ui, sans - serif`;

    // 2. Update Actions (Search Button)
    // Clear previous actions except the close button (which is static)
    // Actually, we can just append the search button if it doesn't exist, or re-create it.
    // Simpler: Clear actions container and re-add Close button? No, Close button is static.
    // Let's just manage the search button specifically.
    let searchBtn = rowsEl.actions.querySelector("#fs-search-btn");
    if (!searchBtn) {
      searchBtn = document.createElement("button");
      searchBtn.className = "iconbtn";
      searchBtn.id = "fs-search-btn";
      searchBtn.setAttribute("aria-label", "Search this font");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", "11");
      circle.setAttribute("cy", "11");
      circle.setAttribute("r", "8");

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "21");
      line.setAttribute("y1", "21");
      line.setAttribute("x2", "16.65");
      line.setAttribute("y2", "16.65");

      svg.appendChild(circle);
      svg.appendChild(line);
      searchBtn.appendChild(svg);
      rowsEl.actions.insertBefore(searchBtn, rowsEl.actions.firstChild); // Insert before Close button
    }

    // Update search button listeners (clone to remove old listeners or just update handler?)
    // Cloning is safer to avoid duplicate listeners
    const newSearchBtn = searchBtn.cloneNode(true);
    searchBtn.replaceWith(newSearchBtn);
    searchBtn = newSearchBtn;

    let tip = null;
    searchBtn.addEventListener("mouseenter", ev => { if (!tip) tip = makeTooltip("Search this font", ev); });
    searchBtn.addEventListener("mousemove", ev => { tip?.update(ev.clientX, ev.clientY); });
    searchBtn.addEventListener("mouseleave", () => { tip?.remove(); tip = null; });
    searchBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      window.open(`https://www.bing.com/search?q=${encodeURIComponent(familyResolved + " font")}`, "_blank", "noopener");
    });

    // 3. Update Grid Metrics
    rowsEl.grid.replaceChildren(); // Clear grid

    const addMetric = (label, value) => {
      const cell = document.createElement("div");
      cell.className = "cell";

      const lbl = document.createElement("label");
      lbl.textContent = label;

      const val = document.createElement("div");
      val.className = "value";
      val.textContent = value;

      cell.appendChild(lbl);
      cell.appendChild(val);
      rowsEl.grid.appendChild(cell);
    };

    addMetric("Weight", weightText);
    addMetric("Style", cs.fontStyle || "normal");
    addMetric("Size", size);
    addMetric("Line Height", lineHeight);
    addMetric("Letter Spacing", letterSpacing);
    addMetric("Decoration", cs.textDecorationLine !== "none" ? cs.textDecorationLine : "None");

    // 4. Update Color Section
    rowsEl.color.replaceChildren();

    // Left: Identity
    const identity = document.createElement("div");
    identity.className = "color-identity";

    const miniSwatch = document.createElement("div");
    miniSwatch.className = "mini-swatch";
    miniSwatch.style.backgroundColor = color;

    const hexValue = document.createElement("span");
    hexValue.className = "color-value";
    hexValue.textContent = colorHex;

    identity.appendChild(miniSwatch);
    identity.appendChild(hexValue);

    // Right: Actions
    const actions = document.createElement("div");
    actions.className = "copy-actions";

    // Helper to create copy buttons
    const createCopyBtn = (label, textToCopy) => {
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = label;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation(); // prevent closing if we had that logic
        navigator.clipboard?.writeText(textToCopy)
          .then(() => toast(`Copied ${label}`, ev.clientX, ev.clientY))
          .catch(() => toast("Failed", ev.clientX, ev.clientY));
      });
      return btn;
    };

    // Prepare formats
    const rgb = parseHexToRgb(colorHex) || [0, 0, 0];
    const rgbStr = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    const hslStr = `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`;

    // Simple CMYK conversion
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    let k = 1 - Math.max(r, g, b);
    let c = (1 - r - k) / (1 - k) || 0;
    let m = (1 - g - k) / (1 - k) || 0;
    let y = (1 - b - k) / (1 - k) || 0;
    // Round to percentages
    const cmykStr = `cmyk(${Math.round(c * 100)}%, ${Math.round(m * 100)}%, ${Math.round(y * 100)}%, ${Math.round(k * 100)}%)`;

    actions.appendChild(createCopyBtn("HEX", colorHex));
    actions.appendChild(createCopyBtn("RGB", rgbStr));
    actions.appendChild(createCopyBtn("HSL", hslStr));
    actions.appendChild(createCopyBtn("CMYK", cmykStr));

    rowsEl.color.appendChild(identity);
    rowsEl.color.appendChild(actions);

    lastClick = { x: e.clientX, y: e.clientY };
    positionPopup(lastClick.x, lastClick.y);
    if (el && el !== document.body) showHighlight(el);
  };

  const onKey = (e) => { if (e.key === "Escape") stop(); };

  // lifecycle
  const start = () => {
    document.documentElement.classList.add("fontseek-picking");
    showExit();
    clickHandler = (ev) => onInteraction(ev);
    keyHandler = (ev) => onKey(ev);

    // Aggressive blocking: capture click, mousedown, mouseup, pointerdown, pointerup
    // Attach to WINDOW to intercept before document/body listeners
    const opts = { capture: true, passive: false };
    window.addEventListener("click", clickHandler, opts);
    window.addEventListener("mousedown", clickHandler, opts);
    window.addEventListener("mouseup", clickHandler, opts);
    window.addEventListener("pointerdown", clickHandler, opts);
    window.addEventListener("pointerup", clickHandler, opts);

    window.addEventListener("keydown", keyHandler, true);
  };
  var stop = () => {
    if (popupHost) popupHost.remove();
    popupHost = popupRoot = popupCard = rowsEl = null;
    if (allFontsHost) allFontsHost.remove();
    allFontsHost = null;
    document.getElementById("fs-exit")?.remove();
    exitEl = null;
    highlightEl?.remove(); highlightEl = null;
    document.documentElement.classList.remove("fontseek-picking");

    const opts = { capture: true, passive: false };
    window.removeEventListener("click", clickHandler, opts);
    window.removeEventListener("mousedown", clickHandler, opts);
    window.removeEventListener("mouseup", clickHandler, opts);
    window.removeEventListener("pointerdown", clickHandler, opts);
    window.removeEventListener("pointerup", clickHandler, opts);

    window.removeEventListener("keydown", keyHandler, true);
    window.__FS_ACTIVE__ = false; window.__FS_API__ = null;
  };

  window.__FS_API__ = { stop };
  start();
})();
