/**
 * FontSeek content script
 * Lightweight font inspector with CSP-safe Shadow DOM UI.
 * - Click the extension icon to enable pick mode.
 * - Click any visible text → show details popup near cursor.
 * - Exit via the floating pill or press ESC.
 * 
 * No external dependencies. MV3-ready.
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
  let popupHost = null, popupRoot = null, popupCard = null, rowsEl = null, swatchEl = null;

  // ======= utils: DOM/text presence =======
  const isTextual = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.fontSize !== "0px";
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
  const findTextElement = (start) => {
    let el = start;
    for (let i = 0; i < 8 && el; i++) {
      if (isTextual(el) && hasAnyText(el)) return el;
      el = ascend(el);
    }
    return null;
  };

  // ======= font family helpers =======
  const genericSet = new Set([
    "system-ui","ui-sans-serif","ui-serif","ui-monospace","ui-rounded",
    "sans-serif","serif","monospace","cursive","fantasy","emoji","math","fangsong"
  ]);
  const ALIAS_SET = new Set(["-apple-system","blinkmacsystemfont"]);

  const parseFamilies = (fontFamilyStr) =>
    String(fontFamilyStr || "")
      .split(",")
      .map(s => s.trim().replace(/^['\"]|['\"]$/g, ""))
      .filter(Boolean);

  // ======= font availability (strict, canvas) =======
  const fontAvailCache = new Map();
  function measure(text, fontSizePx, family, fallback) {
    const span = document.createElement("span");
    span.textContent = text;
    Object.assign(span.style, {
      position:"absolute", left:"-9999px", top:"0",
      fontSize: fontSizePx+"px", fontWeight:"400", fontStyle:"normal",
      letterSpacing:"0", lineHeight:"normal", whiteSpace:"nowrap",
      fontFamily: `"${family}", ${fallback}`
    });
    document.documentElement.appendChild(span);
    const out = [span.offsetWidth, span.offsetHeight];
    span.remove();
    return out;
  }
  function canvasAvailable(family) {
    try {
      const WIDE="MW@#Il1Oo0WWMWMWmmmmmmmmmmmm", NARROW=".,;:iIl!|[]()ftjrxn";
      const sizes=[32,48], fbs=["serif","sans-serif","monospace"];
      const base={};
      for (const s of sizes) {
        base[s]={};
        for (const f of fbs) {
          base[s][f]={ W: measure(WIDE,s,"_fs_fake_",f), N: measure(NARROW,s,"_fs_fake_",f) };
        }
      }
      const differsAll = (getter) =>
        fbs.every(f => sizes.every(sz => {
          const d = getter(sz,f), r = base[sz][f];
          return (d[0]!==r.W[0] || d[1]!==r.W[1]) || (d[0]!==r.N[0] || d[1]!==r.N[1]);
        }));
      const gW = (sz,f)=>measure(WIDE,sz,family,f);
      const gN = (sz,f)=>measure(NARROW,sz,family,f);
      return differsAll(gW) || differsAll(gN);
    } catch { return false; }
  }
  function isFontAvailable(nameRaw){
    if (!nameRaw) return false;
    const name = String(nameRaw).trim().replace(/^['\"]|['\"]$/g,"");
    const low = name.toLowerCase();
    if (fontAvailCache.has(low)) return fontAvailCache.get(low);
    if (genericSet.has(low)) { fontAvailCache.set(low, true); return true; }
    const ok = canvasAvailable(name);
    fontAvailCache.set(low, ok);
    return ok;
  }
  function metricsEqual(a, b){
    const text = "MW@#Il1Oo0mmmmWWW";
    const sz = 40;
    const fbs = ["serif","sans-serif","monospace"];
    return fbs.every(fb => {
      const da = measure(text, sz, a, fb);
      const db = measure(text, sz, b, fb);
      return da[0]===db[0] && da[1]===db[1];
    });
  }
  function mapAliasToPlatformFont(alias){
    const ua = navigator.userAgent || "";
    const isMac = /Macintosh|Mac OS X/.test(ua);
    const isWin = /Windows/.test(ua);
    let candidates = [];
    if (isWin) candidates = ["Segoe UI Variable","Segoe UI","Arial"];
    else if (isMac) candidates = ["SF Pro Text","SF Pro Display","Helvetica Neue","Helvetica","Arial"];
    else candidates = ["Ubuntu","Cantarell","DejaVu Sans","Noto Sans","Liberation Sans","Arial"];
    for (const c of candidates) {
      if (isFontAvailable(c) && metricsEqual(alias, c)) return c;
    }
    return isWin ? "Segoe UI" : (isMac ? "SF Pro" : "system-ui");
  }

  // resolver: pick first real available font; alias used internally only (not displayed)
  const resolveFamily = (startEl) => {
    const seen = new Set();
    let firstAlias = null;
    let firstGeneric = null;
    let chosen = null;

    const scanList = (families) => {
      for (const raw of families) {
        const name = raw.trim().replace(/^['\"]|['\"]$/g,"");
        if (!name) continue;
        const low = name.toLowerCase();
        if (seen.has(low)) continue;
        seen.add(low);
        if (ALIAS_SET.has(low)) { if (!firstAlias) firstAlias = name; continue; }
        if (genericSet.has(low)) { if (!firstGeneric) firstGeneric = name; continue; }
        if (!chosen && isFontAvailable(name)) { chosen = name; }
      }
    };

    let node = startEl;
    for (let i=0;i<8 && node;i++){
      try {
        if (node.nodeType===1){
          scanList(parseFamilies(getComputedStyle(node).fontFamily));
        }
      } catch {}
      node = ascend(node);
    }
    try { scanList(parseFamilies(getComputedStyle(document.body).fontFamily)); } catch {}
    try { scanList(parseFamilies(getComputedStyle(document.documentElement).fontFamily)); } catch {}

    if (chosen) return chosen;
    if (firstAlias) return mapAliasToPlatformFont(firstAlias);
    return firstGeneric || "system-ui";
  };

  // color helpers
  const rgbToHex = (rgb) => {
    const m = String(rgb).replace(/\s+/g,"").match(/^rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)$/i);
    if (!m) {
      if (/^#([0-9a-f]{3,8})$/i.test(rgb)) return rgb.toUpperCase();
      const d = document.createElement("span"); d.style.color = rgb; document.body.appendChild(d);
      const c = getComputedStyle(d).color; d.remove();
      return rgbToHex(c);
    }
    const to2 = (n)=>Number(n).toString(16).padStart(2,"0");
    const r=to2(m[1]), g=to2(m[2]), b=to2(m[3]);
    if (m[4] !== undefined && m[4] !== "1") { const a=Math.round(parseFloat(m[4])*255); return `#${r}${g}${b}${to2(a)}`.toUpperCase(); }
    return `#${r}${g}${b}`.toUpperCase();
  };
  const parseHexToRgb = (hex) => {
    hex = String(hex||"").trim();
    if(!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
    const v = hex.slice(1);
    let r,g,b;
    if (v.length===3){ r=parseInt(v[0]+v[0],16); g=parseInt(v[1]+v[1],16); b=parseInt(v[2]+v[2],16); }
    else { r=parseInt(v.slice(0,2),16); g=parseInt(v.slice(2,4),16); b=parseInt(v.slice(4,6),16); }
    return [r,g,b];
  };
  const rgbToHsl = (r,g,b) => {
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h=0,s=0; const l=(max+min)/2;
    if(max!==min){
      const d=max-min;
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h=(g-b)/d + (g<b?6:0); break;
        case g: h=(b-r)/d + 2; break;
        case b: h=(r-g)/d + 4; break;
      }
      h/=6;
    }
    return [Math.round(h*360), Math.round(s*100), Math.round(l*100)];
  };

  // viewport util (handles visualViewport if available)
  const getViewport = () => {
    const g = (typeof globalThis !== "undefined" ? globalThis : self);
    const vv = g.visualViewport;
    const vw = (vv && vv.width)  || g.innerWidth  || document.documentElement.clientWidth  || 1024;
    const vh = (vv && vv.height) || g.innerHeight || document.documentElement.clientHeight || 768;
    const sx = (vv && vv.pageLeft) || g.scrollX || document.documentElement.scrollLeft || 0;
    const sy = (vv && vv.pageTop)  || g.scrollY || document.documentElement.scrollTop  || 0;
    return { vw, vh, sx, sy };
  };

  // highlight selection
  const showHighlight = (el) => {
    if (!highlightEl) {
      highlightEl = document.createElement("div");
      highlightEl.id = "fs-highlight";
      Object.assign(highlightEl.style, {
        position:"absolute", zIndex:"2147483646",
        border:"2px solid rgba(99,102,241,.9)", borderRadius:"8px",
        boxShadow:"0 0 0 3px rgba(99,102,241,.25)",
        pointerEvents:"none"
      });
      document.documentElement.appendChild(highlightEl);
    }
    const r = el.getBoundingClientRect();
    const { sx, sy } = getViewport();
    highlightEl.style.left = `${r.left + sx - 4}px`;
    highlightEl.style.top  = `${r.top  + sy - 4}px`;
    highlightEl.style.width  = `${r.width  + 8}px`;
    highlightEl.style.height = `${r.height + 8}px`;
    setTimeout(() => { highlightEl?.remove(); highlightEl = null; }, 1000);
  };

  // exit pill
  const showExit = () => {
    exitEl = document.createElement("div");
    exitEl.id = "fs-exit";
    exitEl.innerHTML = `<span style="width:8px;height:8px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25)"></span><span style="margin:0 6px 0 4px">FontSeek Active</span><button type="button" style="all:unset;color:#fff;cursor:pointer;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)">Exit</button>`;
    Object.assign(exitEl.style, {
      position:"fixed", top:"16px", right:"16px", zIndex:"2147483647",
      display:"inline-flex", alignItems:"center", gap:"10px",
      padding:"10px 14px", color:"#fff",
      background:"rgba(17,17,17,0.90)", border:"1px solid rgba(255,255,255,0.14)", borderRadius:"999px",
      backdropFilter:"blur(14px) saturate(120%)", boxShadow:"0 24px 72px rgba(0,0,0,.6)",
      font:"500 12.5px/1 system-ui,-apple-system,Segoe UI,Roboto,Arial"
    });
    exitEl.querySelector("button").addEventListener("click", stop);
    document.documentElement.appendChild(exitEl);
  };

  // weight helpers
  const WEIGHT_NAMES = {100:"Thin",200:"Extra Light",300:"Light",400:"Regular",500:"Medium",600:"Semi Bold",700:"Bold",800:"Extra Bold",900:"Black"};
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
  const bucketWeight = (n) => Math.min(900, Math.max(100, Math.round(n/100)*100));
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
    Object.assign(popupHost.style,{position:"absolute",zIndex:"2147483647",inset:"0 auto auto 0"});
    popupRoot = popupHost.attachShadow({ mode:"open" });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host{ all: initial; }
      *{ box-sizing:border-box; }
      .card{
        min-width:440px; max-width:600px;
        background: rgba(17,17,17,0.90);
        border:1px solid rgba(255,255,255,0.14);
        border-radius:14px;
        box-shadow: 0 24px 72px rgba(0,0,0,.6);
        -webkit-backdrop-filter: blur(16px) saturate(150%);
        backdrop-filter: blur(16px) saturate(150%);
        overflow:hidden; color:#fff;
        font:400 13.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,"Noto Sans";
      }
      .head{ display:flex; align-items:center; justify-content:space-between; padding:12px 14px; }
      .title{ font-size:12.5px; letter-spacing:.02em; opacity:.9; }
      .xbtn{ all:unset; cursor:pointer; font-size:12.5px; padding:6px 10px; border-radius:10px; color:#fff; }
      .xbtn:hover{ background: rgba(255,255,255,.10); }
      .body{ padding: 4px 8px 12px 8px; }
      table{ width:100%; border-collapse: collapse; }
      tbody tr{ border-bottom:1px solid rgba(255,255,255,0.05); }
      tbody tr:last-child{ border-bottom:none; }
      td{ padding:10px 14px; vertical-align:top; }
      td.label{ width:32%; font-weight:600; color:#e4e4e7; }
      td.value{ width:68%; word-break:break-word; color:#fafafa; }
      .tip{
        position:fixed; z-index:10; max-width:280px; padding:8px 10px;
        background: rgba(0,0,0,.92); color:#fff; border:1px solid rgba(255,255,255,.15);
        border-radius:10px; box-shadow:0 12px 36px rgba(0,0,0,.5);
        font: 12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial;
        pointer-events:none; white-space:pre; opacity:0; transform: translateY(-2px); transition: opacity .12s ease, transform .12s ease;
      }
      .tip.show{ opacity:1; transform: translateY(0); }
      .toast{ position:fixed; z-index:11; padding:8px 10px; background:rgba(34,197,94,.95); color:#071; border-radius:10px; font:12px/1.2 system-ui; }
      .iconbtn{
        all: unset; display:inline-flex; align-items:center; justify-content:center;
        width:20px; height:20px; margin-left:8px; border-radius:6px; cursor:pointer;
        color:#fff; opacity:.85; outline: none;
        transition: transform .08s ease;
      }
      .iconbtn:hover{ background:rgba(255,255,255,.10); opacity:1; transform: scale(1.06); }
      .iconbtn:focus-visible{ outline: 2px solid rgba(59,130,246,.9); outline-offset: 2px; }
      .iconbtn svg{ width:14px; height:14px; }
    `);
    popupRoot.adoptedStyleSheets = [sheet];

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="card">
        <div class="head">
          <div class="title">🅰️ Font Details</div>
          <button class="xbtn" id="close">✕</button>
        </div>
        <div class="body"><table><tbody id="rows"></tbody></table></div>
      </div>
    `;
    popupRoot.appendChild(wrap);

    popupCard = popupRoot.querySelector(".card");
    rowsEl = popupRoot.getElementById("rows");

    popupRoot.getElementById("close").addEventListener("click", closePopup);

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
    const top  = Math.min(y + pad, vh - H - pad) + sy;
    popupHost.style.left = left + "px";
    popupHost.style.top  = top  + "px";
    popupHost.style.visibility = "visible";
  };

  const closePopup = () => {
    if (popupHost) { popupHost.remove(); popupHost = null; popupRoot = null; popupCard = null; rowsEl = null; swatchEl = null; }
  };

  const makeTooltip = (text, e) => {
    if (!popupRoot) return null;
    const t = document.createElement("div");
    t.className = "tip";
    t.textContent = text;
    popupRoot.appendChild(t);
    const pad=10, vw=innerWidth, vh=innerHeight;
    const r=t.getBoundingClientRect();
    let x=e.clientX+pad, y=e.clientY+pad;
    if(x+r.width>vw-6) x=vw-r.width-6;
    if(y+r.height>vh-6) y=vh-r.height-6;
    t.style.left=x+'px'; t.style.top=y+'px';
    // animate in
    requestAnimationFrame(() => t.classList.add("show"));
    return t;
  };
  const toast = (msg, x, y) => {
    if (!popupRoot) return;
    const el=document.createElement('div');
    el.className='toast';
    el.textContent=msg;
    popupRoot.appendChild(el);
    el.style.left=(x+12)+'px';
    el.style.top=(y+12)+'px';
    setTimeout(()=>{ el.style.transition='opacity .25s'; el.style.opacity='0'; setTimeout(()=>el.remove(), 250); }, 800);
  };

  // ======= click handler =======
  const onClick = (e) => {
    // ignore clicks on our UI
    if ((exitEl && (e.target === exitEl || exitEl.contains(e.target))) ||
        (popupHost && (e.target === popupHost || popupHost.contains(e.target)))) return;

    const path = typeof e.composedPath === "function" ? e.composedPath() : null;
    const base = path && path.length ? path[0] : e.target;

    let el = findTextElement(base);
    let cs;
    if (el && isTextual(el)) cs = getComputedStyle(el);
    else { el = document.body || document.documentElement; cs = getComputedStyle(el); }

    const familyResolved = resolveFamily(el);
    const weightText = formatWeight(cs.fontWeight || "-");
    const size = cs.fontSize || "-";
    const letterSpacing = cs.letterSpacing || "-";
    const lineHeight = cs.lineHeight || "-";
    const color = cs.color || "rgb(0,0,0)";
    const colorHex = rgbToHex(color);

    ensurePopup();

    rowsEl.innerHTML = "";

    // helpers (must be defined before use)
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const cssSafe = (s) => String(s).replace(/["'<>]/g, "");

    const add = (label, valueHtml) => {
      const tr = document.createElement("tr");
      const tdL = document.createElement("td"); tdL.className="label"; tdL.textContent = label;
      const tdV = document.createElement("td"); tdV.className="value"; tdV.innerHTML = valueHtml;
      tr.appendChild(tdL); tr.appendChild(tdV);
      rowsEl.appendChild(tr);
    };

    // Font Family row with search action
    (() => {
      const tr = document.createElement("tr");
      const tdL = document.createElement("td"); tdL.className = "label"; tdL.textContent = "Font Family";
      const tdV = document.createElement("td"); tdV.className = "value";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = familyResolved;

      const btn = document.createElement("button");
      btn.className = "iconbtn";
      btn.setAttribute("aria-label", "Search this font");
      btn.setAttribute("title", "Search this font");
      btn.setAttribute("tabindex", "0");
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      `;

      let tip = null;
      btn.addEventListener("mouseenter", ev => { if(!tip) tip = makeTooltip("Search this font", ev); });
      btn.addEventListener("mousemove",  ev => {
        if(!tip) return;
        const r=tip.getBoundingClientRect(); let x=ev.clientX+10, y=ev.clientY+10;
        const vw=innerWidth, vh=innerHeight;
        if(x+r.width>vw-6)x=vw-r.width-6; if(y+r.height>vh-6)y=vh-r.height-6;
        tip.style.left=x+'px'; tip.style.top=y+'px';
      });
      btn.addEventListener("mouseleave", () => { tip?.remove(); tip=null; });
      btn.addEventListener("keydown", ev => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); btn.click(); }
      });
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const q = familyResolved;
        window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}+font`, "_blank", "noopener");
      });

      tdV.appendChild(nameSpan);
      tdV.appendChild(btn);
      tr.appendChild(tdL); tr.appendChild(tdV);
      rowsEl.appendChild(tr);
    })();

    // remaining rows
    add("Font Style", escapeHtml(cs.fontStyle || "normal"));
    add("Font Weight", escapeHtml(weightText));
    add("Font Size", escapeHtml(size));
    add("Letter Spacing", escapeHtml(letterSpacing));
    add("Line Height", escapeHtml(lineHeight));
    add("Font Color", `${escapeHtml(colorHex)} <span id="fs-swatch" style="display:inline-block;width:12px;height:12px;margin-left:8px;border-radius:4px;border:1px solid rgba(255,255,255,.7);background:${cssSafe(color)}"></span>`);

    // swatch tooltip + copy (HEX / ctrl→RGB / alt→HSL)
    swatchEl = popupRoot.getElementById("fs-swatch");
    if (swatchEl) {
      const rgb = parseHexToRgb(colorHex) || [0,0,0];
      const rgbStr = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      const hslStr = `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`;

      let tip = null;
      const tipText = `${rgbStr} | ${hslStr}`;
      swatchEl.addEventListener("mouseenter", ev => { if(!tip) tip = makeTooltip(tipText, ev); });
      swatchEl.addEventListener("mousemove", ev => {
        if(!tip) return;
        const r=tip.getBoundingClientRect(); let x=ev.clientX+10, y=ev.clientY+10; const vw=innerWidth, vh=innerHeight;
        if(x+r.width>vw-6)x=vw-r.width-6; if(y+r.height>vh-6)y=vh-r.height-6;
        tip.style.left=x+'px'; tip.style.top=y+'px';
      });
      swatchEl.addEventListener("mouseleave", () => { tip?.remove(); tip=null; });
      swatchEl.title = "Click: copy HEX • Ctrl/⌘: RGB • Alt: HSL";
      swatchEl.addEventListener("click", ev => {
        let text = colorHex, label = "HEX";
        if (ev.ctrlKey || ev.metaKey) { text = rgbStr; label = "RGB"; }
        if (ev.altKey) { text = hslStr; label = "HSL"; }
        navigator.clipboard?.writeText(text)
          .then(()=>toast(`Copied ${label}`, ev.clientX, ev.clientY))
          .catch(()=>toast("Copy failed", ev.clientX, ev.clientY));
      });
    }

    lastClick = { x: e.clientX, y: e.clientY };
    positionPopup(lastClick.x, lastClick.y);
    if (el && el !== document.body) showHighlight(el);

    e.preventDefault(); e.stopPropagation();
  };

  const onKey = (e) => { if (e.key === "Escape") stop(); };

  // lifecycle
  const start = () => {
    document.documentElement.classList.add("fontseek-picking");
    showExit();
    clickHandler = (ev) => onClick(ev);
    keyHandler = (ev) => onKey(ev);
    document.addEventListener("click", clickHandler, true);
    window.addEventListener("keydown", keyHandler, true);
  };
  var stop = () => {
    if (popupHost) popupHost.remove();
    popupHost = popupRoot = popupCard = rowsEl = swatchEl = null;
    document.getElementById("fs-exit")?.remove();
    exitEl = null;
    highlightEl?.remove(); highlightEl = null;
    document.documentElement.classList.remove("fontseek-picking");
    document.removeEventListener("click", clickHandler, true);
    window.removeEventListener("keydown", keyHandler, true);
    window.__FS_ACTIVE__ = false; window.__FS_API__ = null;
  };

  window.__FS_API__ = { stop };
  start();
})();
