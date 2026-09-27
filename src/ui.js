/* Strip & Rail: the board, the parts, the tools, the loop. Game rules and physics live in engine.js. */
(function () {
  "use strict";
  const E = window.BenchEngine, { LEVELS, SANDBOX } = window.BenchLevels, SCH = window.SCHEMATICS || {}, C = window.BenchCards;
  const CI = window.BenchCircuit;
  const EXAMPLES = (window.BenchData.EXAMPLES || []).map((ex) => CI.toLevel(CI.parse(ex.text), { id: "ex-" + ex.id, schematic: "ex-" + ex.id, group: "examples" }));
  let IMPORTED = [];                                             // filled in boot, from storage
  let ALL = [...LEVELS, SANDBOX, ...EXAMPLES];
  const rebuildAll = () => { ALL = [...LEVELS, SANDBOX, ...EXAMPLES, ...IMPORTED]; };
  const P = 14, OX = 20, OY = 128;                          // pitch (0.1 in) and the board's origin in the SVG
  const BW = (E.COLS + 3) * P, BH = 19.4 * P;
  const SVGW = OX * 2 + BW, SVGH = OY + BH + 14;
  const TERM = { "PSU.+": [252, 88], "PSU.-": [292, 88] };
  const WIRE = { red: "#e0303b", black: "#1f1f1f", yellow: "#f0c419", green: "#27a349", blue: "#2f6fd6", orange: "#f2862b", white: "#eeeeee" };
  const BAND = ["#111", "#7a4a1f", "#d22", "#f07a00", "#f5d000", "#2a9d2a", "#2458d6", "#8a3bc4", "#888", "#f4f4f4"];
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("strip-rail:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("strip-rail:" + k, JSON.stringify(v)); } catch (e) { /* storage off: play on */ } },
  };

  const G = {
    li: 0, level: null, parts: [], bin: [], tool: { kind: "none" }, pending: null, hover: null, wireColor: "yellow",
    power: false, sim: null, pressed: {}, pots: {}, probes: [], hints: [], hintStep: 0, nets: null,
    solved: store.get("solved", {}), meter: { mode: "V", blown: false }, sound: "off",
    visited: new Set(store.get("visited", Object.keys(store.get("solved", {})))),
    collected: new Set(store.get("cards", ["breadboard", "wire", "supply"])), cardView: null, cardPage: 0,
  };

  // ------------------------------------------------------------------ formatting
  const fmtR = (v) => v >= 1e6 ? v / 1e6 + " MΩ" : v >= 1000 ? v / 1000 + " kΩ" : v + " Ω";
  const fmtC = (v) => v >= 1e-6 ? +(v * 1e6).toPrecision(3) + " µF" : +(v * 1e9).toPrecision(3) + " nF";
  // part-specific knowledge comes from data/parts: how it's drawn, what it's called, what its legs are
  const partOf = (p) => E.LIB[p.type] || {};
  const drawOf = (p) => partOf(p).draw || p.type;
  const kindOf = (p) => E.kindOf(p);
  /** A part's bin label from its data template: "{value:Ω} resistor" -> "330 Ω resistor", "{color} LED" -> "Red LED". */
  function itemLabel(it) {
    const d = partOf(it);
    return (d.label || d.name || it.type).replace(/\{(\w+)(?::([^}]*))?\}/g, (m, key, unit) => {
      if (key === "color") { const o = d.params && d.params.color && d.params.color.options[it.color]; return o ? o.name : it.color; }
      return unit !== undefined ? window.BenchCalc.fmt(it[key], unit) : String(it[key]);
    });
  }
  function bands(v) {
    const e = Math.floor(Math.log10(v)) - 1, d = Math.round(v / Math.pow(10, e));
    return [BAND[Math.floor(d / 10)], BAND[d % 10], (e >= 0 ? BAND[e] : e === -1 ? "#c9a227" : "#b8b8b8"), "#c9a227"];
  }

  // ------------------------------------------------------------------ geometry
  function xy(pt) {
    if (E.isTerminal(pt)) return TERM[pt];
    const h = E.parseHole(pt);
    return [OX + (h.col + 1) * P, OY + E.ROW_Y[h.row] * P];
  }
  function holeAt(x, y) {
    for (const [id, [tx, ty]] of Object.entries(TERM)) if (Math.hypot(x - tx, y - ty) < 14) return id;
    const col = Math.round((x - OX) / P - 1);
    if (Math.abs(x - (OX + (col + 1) * P)) > P * 0.55) return null;
    let best = null, bd = 1e9;
    for (const r of Object.keys(E.ROW_Y)) { const dy = Math.abs(y - (OY + E.ROW_Y[r] * P)); if (dy < bd) { bd = dy; best = r; } }
    if (bd > P * 0.55) return null;
    const id = best + col;
    return E.isHole(id) ? id : null;
  }
  const occupied = (h) => !E.isTerminal(h) && G.parts.some((p) => Object.values(p.pins).includes(h));
  function segDist(px, py, [ax, ay], [bx, by]) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function partAt(x, y) {
    let best = null, bd = 9;
    for (const p of G.parts) {
      const pts = Object.values(p.pins).map(xy);
      let d;
      if (E.TYPES[p.type] && E.TYPES[p.type].dip) {
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        d = x >= Math.min(...xs) - 8 && x <= Math.max(...xs) + 8 && y >= Math.min(...ys) - 4 && y <= Math.max(...ys) + 4 ? 0 : 99;
      } else if (E.TYPES[p.type] && E.TYPES[p.type].row) {
        const xs = pts.map((q) => q[0]);
        const top = drawOf(p) === "module" ? 30 : 18;
        d = x >= Math.min(...xs) - 8 && x <= Math.max(...xs) + 8 && y >= pts[0][1] - top && y <= pts[0][1] + 6 ? 0 : 99;
      } else {
        d = segDist(x, y, pts[0], pts[1]);
        if (kindOf(p) !== "wire") d = Math.min(d, Math.hypot(x - (pts[0][0] + pts[1][0]) / 2, y - (pts[0][1] + pts[1][1]) / 2) - 6);
      }
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ------------------------------------------------------------------ the SVG
  let svg, L = {};
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  function buildSVG() {
    svg = el("svg", { viewBox: `0 0 ${SVGW} ${SVGH}`, role: "application", "aria-label": "Breadboard" });
    const defs = el("defs", {}, svg);
    const soft = el("filter", { id: "soft", x: "-20%", y: "-20%", width: "140%", height: "140%" }, defs);
    el("feGaussianBlur", { stdDeviation: "2.6" }, soft);
    for (const [name, c] of Object.entries(E.LED_COLORS)) {
      const g = el("radialGradient", { id: "glow-" + name }, defs);
      el("stop", { offset: "0", "stop-color": `rgb(${c.rgb})`, "stop-opacity": "0.95" }, g);
      el("stop", { offset: "0.35", "stop-color": `rgb(${c.rgb})`, "stop-opacity": "0.55" }, g);
      el("stop", { offset: "1", "stop-color": `rgb(${c.rgb})`, "stop-opacity": "0" }, g);
    }
    // the bench supply
    const s = el("g", {}, svg);
    el("rect", { x: 20, y: 12, width: 310, height: 100, rx: 8, fill: "#2a2f33", stroke: "#0c0e0f" }, s);
    el("text", { x: 34, y: 30, fill: "#9aa6a4", "font-family": "Silkscreen, monospace", "font-size": 10 }, s).textContent = "BENCH SUPPLY";
    el("rect", { x: 34, y: 38, width: 162, height: 62, rx: 4, fill: "#120c00", stroke: "#000" }, s);
    L.psuV = el("text", { x: 186, y: 66, "text-anchor": "end", fill: "#6b4a00", "font-family": "JetBrains Mono, monospace", "font-size": 22 }, s);
    L.psuI = el("text", { x: 186, y: 92, "text-anchor": "end", fill: "#6b4a00", "font-family": "JetBrains Mono, monospace", "font-size": 16 }, s);
    L.psuMode = el("text", { x: 42, y: 92, fill: "#6b4a00", "font-family": "JetBrains Mono, monospace", "font-size": 11 }, s);
    L.psuSet = el("text", { x: 208, y: 30, fill: "#9aa6a4", "font-family": "JetBrains Mono, monospace", "font-size": 9.5 }, s);
    L.psuOut = el("circle", { cx: 214, cy: 88, r: 4, fill: "#233" }, s);
    el("text", { x: 208, y: 106, fill: "#9aa6a4", "font-family": "JetBrains Mono, monospace", "font-size": 8 }, s).textContent = "OUT";
    for (const [id, [tx, ty]] of Object.entries(TERM)) {
      const plus = id.endsWith("+");
      el("circle", { cx: tx, cy: ty, r: 10, fill: plus ? "#c8202b" : "#1a1a1a", stroke: "#000" }, s);
      el("circle", { cx: tx, cy: ty, r: 4, fill: "#d9d4c7" }, s);
      el("text", { x: tx, y: ty - 15, "text-anchor": "middle", fill: plus ? "#ff6a6a" : "#cfd8d6", "font-size": 13, "font-weight": 700 }, s).textContent = plus ? "+" : "−";
    }
    // the breadboard
    const b = el("g", {}, svg);
    el("rect", { x: OX, y: OY, width: BW, height: BH, rx: 6, fill: "#efece3", stroke: "#c8c3b4" }, b);
    el("rect", { x: OX, y: OY + 9.2 * P, width: BW, height: P, fill: "#e0dcd0" }, b);
    for (const [r, dy, col] of [["T-", -0.62, "#2b6cc4"], ["T+", 0.62, "#d7263d"], ["B-", -0.62, "#2b6cc4"], ["B+", 0.62, "#d7263d"]]) {
      const y = OY + (E.ROW_Y[r] + dy) * P;
      el("line", { x1: OX + 2 * P, y1: y, x2: OX + (E.COLS + 1) * P, y2: y, stroke: col, "stroke-width": 1.6 }, b);
      for (const x of [OX + 1.1 * P, OX + BW - 1.1 * P]) {
        el("text", { x, y: OY + E.ROW_Y[r] * P + 4.5, "text-anchor": "middle", fill: col, "font-size": 13, "font-weight": 700 }, b).textContent = r.endsWith("+") ? "+" : "−";
      }
    }
    L.hi = el("g", {}, svg);                                   // strip highlight sits under the holes
    const holes = el("g", {}, b);
    let d = "";
    for (const h of E.allHoles()) { const [x, y] = xy(h); d += `M${x - 2.6},${y - 2.6}h5.2v5.2h-5.2z`; }
    el("path", { d, class: "hole" }, holes);
    L.live = el("g", { filter: "url(#soft)" }, svg);        // powered strips glow by voltage
    svg.appendChild(L.live);
    svg.appendChild(L.hi);
    svg.appendChild(holes);
    for (const r of [...E.ROWS_TOP, ...E.ROWS_BOT]) {
      const y = OY + E.ROW_Y[r] * P + 3.5;
      for (const x of [OX + 0.85 * P, OX + BW - 0.85 * P]) el("text", { x, y, "text-anchor": "middle", fill: "#9b9585", "font-size": 8.5 }, b).textContent = r;
    }
    for (const c of [1, ...Array.from({ length: 12 }, (_, i) => (i + 1) * 5)]) {
      const x = OX + (c + 1) * P;
      el("text", { x, y: OY + 3.4 * P, "text-anchor": "middle", fill: "#9b9585", "font-size": 8 }, b).textContent = c;
      el("text", { x, y: OY + 16.45 * P, "text-anchor": "middle", fill: "#9b9585", "font-size": 8 }, b).textContent = c;
    }
    L.parts = el("g", {}, svg);
    L.wires = el("g", {}, svg);
    L.labels = el("g", { "pointer-events": "none" }, svg);
    L.fx = el("g", {}, svg);
    L.ghost = el("g", { "pointer-events": "none" }, svg);
    L.hint = el("g", { "pointer-events": "none" }, svg);
    L.probes = el("g", { "pointer-events": "none" }, svg);
    L.tags = el("g", { "pointer-events": "none" }, svg);     // volts / milliamps readouts, on top of everything
    $("stage").appendChild(svg);

    const pt = svg.createSVGPoint();
    const toSvg = (ev) => { pt.x = ev.clientX; pt.y = ev.clientY; const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 }; };
    svg.addEventListener("pointermove", (ev) => { const q = toSvg(ev); G.hover = holeAt(q.x, q.y); G.hoverXY = [q.x, q.y]; renderHover(); renderTags(); });
    svg.addEventListener("pointerleave", () => { G.hover = null; G.hoverXY = null; renderHover(); renderTags(); release(); });
    svg.addEventListener("pointerdown", (ev) => {
      const q = toSvg(ev), p = partAt(q.x, q.y);
      if (p && kindOf(p) === "button" && G.tool.kind !== "remove") { G.pressed[p.id] = true; G.pressing = p.id; renderParts(); ev.preventDefault(); }
    });
    window.addEventListener("pointerup", release);
    svg.addEventListener("click", (ev) => {
      if (G.pressing || G.justReleased) { G.justReleased = false; return; }
      const q = toSvg(ev);
      if (G.tool.kind === "remove") { const p = partAt(q.x, q.y); if (p) removePart(p); return; }
      const h = holeAt(q.x, q.y);
      if (G.tool.kind === "none") { const p = partAt(q.x, q.y); if (p && C.FOR_PART[p.type]) { showCard(C.FOR_PART[p.type], variantOf(p)); return; } }
      if (h) clickPoint(h);
    });
    svg.addEventListener("contextmenu", (ev) => { const q = toSvg(ev), p = partAt(q.x, q.y); if (p) { ev.preventDefault(); removePart(p); } });
  }
  function release() { if (G.pressing) { G.pressed[G.pressing] = false; G.pressing = null; G.justReleased = true; renderParts(); } }

  // ------------------------------------------------------------------ drawing parts
  const legs = (pts) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="#9a9a9a"/>`).join("");
  function body2(p, inner, w = 24) {                         // a two-lead part: legs to a body at the midpoint
    const [a, b] = Object.values(p.pins).map(xy);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#a9a9a9" stroke-width="1.8"/>${legs([a, b])}` +
      `<g transform="translate(${mx},${my}) rotate(${ang})">${inner(w)}</g>`;
  }
  function partSVG(p) {
    const lockedCls = p.locked ? " locked" : "";
    let s = "";
    switch (drawOf(p)) {
      case "wire": {
        const [a, b] = Object.values(p.pins).map(xy), c = WIRE[p.color] || p.color;
        const dx = b[0] - a[0], dy = b[1] - a[1], bow = 0.16;
        const cx = (a[0] + b[0]) / 2 - dy * bow, cy = (a[1] + b[1]) / 2 + dx * bow;
        const d = `M${a[0]},${a[1]} Q${cx},${cy} ${b[0]},${b[1]}`;
        s = `<path d="${d}" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="5.4" stroke-linecap="round"/>` +
          `<path d="${d}" fill="none" stroke="${c}" stroke-width="3.8" stroke-linecap="round"/>` +
          `<circle cx="${a[0]}" cy="${a[1]}" r="2.4" fill="#666"/><circle cx="${b[0]}" cy="${b[1]}" r="2.4" fill="#666"/>`;
        break;
      }
      case "resistor":
        s = body2(p, () => `<rect x="-13" y="-4.6" width="26" height="9.2" rx="4.5" fill="#e3c59b" stroke="#9c7a4a"/>` +
          bands(p.value).map((c, i) => `<rect x="${-8.5 + i * 4.3 + (i === 3 ? 3 : 0)}" y="-4.6" width="2.3" height="9.2" fill="${c}"/>`).join(""));
        break;
      case "diode":
        s = body2(p, () => `<rect x="-9" y="-3.4" width="18" height="6.8" rx="3" fill="#e9a07a" fill-opacity=".85" stroke="#a0522d"/><rect x="4.5" y="-3.4" width="2.6" height="6.8" fill="#222"/>`);
        break;
      case "capacitor":
        s = body2(p, () => `<ellipse rx="6.5" ry="5.2" fill="#d99a2b" stroke="#8a6212"/>`);
        break;
      case "electrolytic":
        s = body2(p, () => `<circle r="7.5" fill="#1d3f8f" stroke="#0b1f4f"/><path d="M3.2,-6.8 A7.5,7.5 0 0,1 3.2,6.8 Z" fill="#c7d3ee"/><text x="4.6" y="2.6" font-size="6" fill="#1d3f8f">−</text>`);
        break;
      case "button": {
        const down = G.pressed[p.id];
        s = body2(p, () => `<rect x="-8" y="-8" width="16" height="16" rx="2" fill="#222" stroke="#000"/><circle r="5.2" fill="${down ? "#555" : "#b8b8b8"}" stroke="#000"/>`);
        break;
      }
      case "led": {
        const [pa, pk] = E.TYPES[p.type].leads, c = E.LED_COLORS[p.color || "red"], [a, k] = [xy(p.pins[pa]), xy(p.pins[pk])];
        const mx = (a[0] + k[0]) / 2, my = (a[1] + k[1]) / 2, ang = Math.atan2(k[1] - a[1], k[0] - a[0]) * 180 / Math.PI;
        const dome = p.burnt ? "#3a3a3a" : `rgb(${c.rgb.map((v) => Math.round(v * 0.55 + 30)).join(",")})`;
        s = `<line x1="${a[0]}" y1="${a[1]}" x2="${k[0]}" y2="${k[1]}" stroke="#a9a9a9" stroke-width="1.8"/>${legs([a, k])}` +
          `<circle id="glow-${p.id}" cx="${mx}" cy="${my}" r="18" fill="url(#glow-${p.color || "red"})" opacity="0"/>` +
          `<g transform="translate(${mx},${my}) rotate(${ang})"><circle r="6.8" fill="${dome}" stroke="rgba(0,0,0,.45)"/>` +
          `<line x1="5.2" y1="-4.4" x2="5.2" y2="4.4" stroke="rgba(0,0,0,.35)" stroke-width="1.4"/>` +
          (p.burnt ? `<path d="M-3,-4 L0,0 L-2,2 L2,5" stroke="#111" stroke-width="1.2" fill="none"/>` : `<circle id="core-${p.id}" cx="-2" cy="-2" r="2.4" fill="#fff" opacity=".35"/>`) + `</g>`;
        break;
      }
      case "pot": {
        const pts = ["1", "W", "3"].map((k) => xy(p.pins[k])), pos = G.pots[p.id] ?? 0.5, ang = -135 + 270 * pos;
        const x0 = pts[0][0] - 8, x1 = pts[2][0] + 8, y = pts[0][1];
        s = legs(pts) + `<rect x="${x0}" y="${y - 20}" width="${x1 - x0}" height="${22}" rx="3" fill="#1f5fae" stroke="#0d3160"/>` +
          `<g transform="translate(${pts[1][0]},${y - 9}) rotate(${ang})"><circle r="7" fill="#f2f2f2" stroke="#999"/><rect x="-1" y="-6.5" width="2" height="6" fill="#333"/></g>`;
        break;
      }
      case "module": {                                          // a breakout board over its row of pins (from data: board.*)
        const d = partOf(p), B = d.board || {}, ids = E.TYPES[p.type].leads, pts = ids.map((k) => xy(p.pins[k]));
        const x0 = pts[0][0] - 9, x1 = pts[pts.length - 1][0] + 9, y = pts[0][1];
        s = legs(pts) + `<rect x="${x0}" y="${y - 30}" width="${x1 - x0}" height="34" rx="3" fill="${B.color || "#1f4fa3"}" stroke="#000" stroke-opacity=".6"/>` +
          `<text x="${x0 + 4}" y="${y - 21}" font-size="7.5" font-weight="700" font-family="JetBrains Mono, monospace" fill="#eee">${esc(B.title || d.name)}</text>` +
          ids.map((k, i) => `<text x="${pts[i][0]}" y="${y - 4}" text-anchor="middle" font-size="5.5" font-family="JetBrains Mono, monospace" fill="#ddd">${esc((d.pins[i].short) || k)}</text>`).join("") +
          (B.mic ? `<circle cx="${x1 - 9}" cy="${y - 19}" r="6" fill="#2b2b2b" stroke="#999"/><circle cx="${x1 - 9}" cy="${y - 19}" r="3" fill="#444"/>` : "") +
          (B.led ? `<circle id="io-${p.id}" cx="${x1 - 7}" cy="${y - 22}" r="3" fill="#233"/>` : "");
        break;
      }
      case "dip": {                                             // any DIP chip: body, notch, pins; its name from data
        const pins = Object.entries(p.pins).map(([k, h]) => [k, xy(h)]), nPins = E.TYPES[p.type].dip;
        const xs = pins.map(([, q]) => q[0]), yE = xy(p.pins[String(nPins)])[1], yF = xy(p.pins["1"])[1];
        const x0 = Math.min(...xs) - 7, x1 = Math.max(...xs) + 7;
        s = pins.map(([, [x, y]]) => `<rect x="${x - 2.5}" y="${y - 3}" width="5" height="6" fill="#c9c9c9" stroke="#777"/>`).join("") +
          `<rect x="${x0}" y="${yE + 4}" width="${x1 - x0}" height="${yF - yE - 8}" rx="2" fill="#262626"/>` +
          `<path d="M${x0},${(yE + yF) / 2 - 5} a5,5 0 0,1 0,10" fill="#555"/>` +
          `<text x="${(x0 + x1) / 2 + 3}" y="${(yE + yF) / 2 + 4}" text-anchor="middle" font-size="10" font-family="JetBrains Mono, monospace" fill="#ddd">${esc(partOf(p).chip || partOf(p).name)}</text>`;
        break;
      }
    }
    return `<g class="part${lockedCls}" data-id="${esc(p.id)}">${s}</g>`;
  }
  /* Leg labels, printed on the parts: they sit in their own layer above the wires so nothing covers them,
     and the Labels toggle (L) hides the layer once the pinouts are in your fingers. */
  function partLabels(p) {
    const T = E.TYPES[p.type];
    if (T && T.dip) {                                          // numbers inside the body, pin 1 in amber by the notch
      const yE = xy(p.pins[String(T.dip)])[1], yF = xy(p.pins["1"])[1];
      return Object.entries(p.pins).map(([n, h]) => {
        const [x] = xy(h), bottom = +n <= T.dip / 2;
        return `<text class="pinlbl chip${n === "1" ? " one" : ""}" x="${x}" y="${bottom ? yF - 7 : yE + 12}" text-anchor="middle">${n}</text>`;
      }).join("");
    }
    return (partOf(p).pins || []).filter((d) => d.label).map((d) => {
      const h = p.pins[d.id]; if (!h) return "";
      const [x, y] = xy(h);
      return `<text class="pinlbl${d.positive ? " pos" : ""}" x="${x}" y="${y + 10.5}" text-anchor="middle">${esc(d.label)}</text>`;
    }).join("");
  }
  function renderParts() {
    L.parts.innerHTML = G.parts.filter((p) => kindOf(p) !== "wire").map(partSVG).join("");
    L.wires.innerHTML = G.parts.filter((p) => kindOf(p) === "wire").map(partSVG).join("");
    L.labels.innerHTML = G.parts.map(partLabels).join("");
    updateLive();
  }

  // ------------------------------------------------------------------ hover, ghost, hints, probes
  function stripRect(key) {
    const [kind, v] = key.split(":");
    if (kind === "rail") { const y = OY + E.ROW_Y[v] * P; return `<rect class="strip-hi" x="${OX + 3.5 * P}" y="${y - 0.45 * P}" width="${59 * P}" height="${0.9 * P}" rx="5"/>`; }
    if (kind === "term") { const [x, y] = TERM[v]; return `<circle class="strip-hi" cx="${x}" cy="${y}" r="15"/>`; }
    const c = +v, x = OX + (c + 1) * P, [r0, r1] = kind === "top" ? ["a", "e"] : ["f", "j"];
    return `<rect class="strip-hi" x="${x - 0.45 * P}" y="${OY + (E.ROW_Y[r0] - 0.45) * P}" width="${0.9 * P}" height="${(E.ROW_Y[r1] - E.ROW_Y[r0] + 0.9) * P}" rx="5"/>`;
  }
  function renderHover() {
    let hi = "";
    if (G.hover) {
      const net = G.nets.netOf(G.hover);
      hi = G.nets.stripsIn(net).map(stripRect).join("");
      if (!G.nets.stripsIn(net).length) hi = stripRect(E.stripOf(G.hover));
    }
    L.hi.innerHTML = hi;
    renderGhost();
    if (G.hover && G.tool.kind === "none" && !G.statusSticky) {
      const occ = G.parts.find((p) => Object.values(p.pins).includes(G.hover));
      const pin = occ && Object.keys(occ.pins).find((k) => occ.pins[k] === G.hover);
      const who = !occ ? "" : kindOf(occ) === "wire" ? `${occ.id} (wire end) · ` : `${occ.id} ${E.pinName(occ, pin)} · `;
      say(`${G.hover}: ${who}${E.describeStrip(E.stripOf(G.hover))}. Everything lit up is connected to it.`);
    }
  }
  function renderGhost() {
    let g = "";
    const t = G.tool;
    const type = t.kind === "wire" ? "wire" : t.kind === "place" ? t.item.type : null;
    if (type && G.hover) {
      const T = E.TYPES[type];
      if (T.dip || T.row) {
        const fp = E.footprint(type, G.hover);
        const ok = !fp.error && !Object.values(fp.pins).some(occupied);
        if (fp.pins) g = Object.values(fp.pins).map((h) => { const [x, y] = xy(h); return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${ok ? "#ffb000" : "#ff5a4f"}" stroke-width="2"/>`; }).join("");
      } else if (G.pending) {
        const fp = E.footprint(type, G.pending, G.hover);
        const ok = fp.pins && !Object.values(fp.pins).some((h) => h !== G.pending && occupied(h));
        const [a, b] = [xy(G.pending), xy(G.hover)];
        g = `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${ok ? "#ffb000" : "#ff5a4f"}" stroke-width="3" stroke-dasharray="5 4" stroke-linecap="round"/>`;
        if (fp.error && G.hover !== G.pending) say(fp.error, true);
      } else {
        const [x, y] = xy(G.hover);
        g = `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${occupied(G.hover) ? "#ff5a4f" : "#ffb000"}" stroke-width="2"/>`;
      }
    }
    if (G.pending) { const [x, y] = xy(G.pending); g += `<circle cx="${x}" cy="${y}" r="5" fill="#ffb000"/>`; }
    if (G.tool.kind === "remove" && G.hoverXY) {
      const p = partAt(...G.hoverXY);
      if (p && !p.locked) { const pts = Object.values(p.pins).map(xy); g += pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#ff5a4f" stroke-width="2"/>`).join(""); }
    }
    L.ghost.innerHTML = g;
  }
  function renderHintRings(holes) {
    L.hint.innerHTML = holes.map((h) => { const [x, y] = xy(h); return `<circle class="hint-ring" cx="${x}" cy="${y}" r="9"/>`; }).join("");
  }
  function renderProbes() {
    let bridge = "";
    if (G.meter.mode === "A" && G.probes.length === 2) {
      const [a, b] = G.probes.map(xy);
      bridge = `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#ffb000" stroke-width="2" stroke-dasharray="3 3"/>` +
        `<g transform="translate(${(a[0] + b[0]) / 2},${(a[1] + b[1]) / 2})"><circle r="8" fill="#111a1c" stroke="#ffb000"/><text y="3.5" text-anchor="middle" font-size="10" font-weight="700" fill="#ffb000">A</text></g>`;
    }
    L.probes.innerHTML = bridge + G.probes.map((h, i) => {
      const [x, y] = xy(h), c = i === 0 ? "#e0303b" : "#1a1a1a";
      return `<line x1="${x}" y1="${y}" x2="${x + 10}" y2="${y - 22}" stroke="${c}" stroke-width="3" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="3.4" fill="${c}" stroke="#fff" stroke-width="1"/>`;
    }).join("");
  }

  // ------------------------------------------------------------------ placing and removing
  function say(msg, bad = false) { const s = $("status"); s.textContent = msg; s.classList.toggle("bad", bad); }
  function toolHelp() {
    const t = G.tool;
    if (t.kind === "wire") return G.pending ? "Click where the other end goes. Esc to cancel." : "Wire: click a hole or a supply terminal for one end.";
    if (t.kind === "meter") return G.probes.length === 1 ? "Red probe placed. Click a second hole for the black probe." : "Meter: click a hole for the red probe, then another for the black.";
    if (t.kind === "remove") return "Click a part or wire to pull it off the board.";
    if (t.kind === "place") {
      const it = t.item, T = E.TYPES[it.type];
      if (T.dip) return "Click where pin 1 goes (row f; the chip straddles the channel, notch to the left).";
      const pins = partOf(it).pins || [];
      if (T.row) return `Click where the ${itemLabel(it).toLowerCase()}'s ${pins[0].name} goes; its ${pins.length} legs sit in a row.`;
      if (pins.some((d) => d.label))                           // legs that matter: name them
        return G.pending ? `Now the ${pins[1].name}.` : `Click where the ${itemLabel(it)}'s ${pins[0].name} goes.`;
      return G.pending ? "Now the other leg." : `Click where the first leg of the ${itemLabel(it).toLowerCase()} goes.`;
    }
    return "Hover a hole to see what it connects to. Pick a part from the bin to place it.";
  }
  function setTool(t) {
    G.tool = t; G.pending = null;
    $("tool-wire").setAttribute("aria-pressed", t.kind === "wire");
    $("tool-meter").setAttribute("aria-pressed", t.kind === "meter");
    $("tool-remove").setAttribute("aria-pressed", t.kind === "remove");
    renderBin(); renderGhost(); say(toolHelp());
  }
  function nextId(type) {
    const pre = E.TYPES[type].prefix, used = new Set(G.parts.filter((p) => p.id.startsWith(pre)).map((p) => p.id));
    let i = 1; while (used.has(pre + i) || (pre === "C" && used.has("C" + i))) i++;
    return pre + i;
  }
  function autoColor(pins) {
    const v = Object.values(pins);
    if (v.some((h) => h === "PSU.+" || h.startsWith("T+") || h.startsWith("B+"))) return "red";
    if (v.some((h) => h === "PSU.-" || h.startsWith("T-") || h.startsWith("B-"))) return "black";
    return G.wireColor;
  }
  function clickPoint(pt) {
    G.statusSticky = false;
    const t = G.tool;
    if (t.kind === "meter") {
      G.probes = G.probes.length >= 2 ? [pt] : [...G.probes, pt];
      renderProbes(); if (G.meter.mode === "A") changed(); updateMeter(true); say(toolHelp()); return;
    }
    if (t.kind !== "place" && t.kind !== "wire") return;
    const type = t.kind === "wire" ? "wire" : t.item.type, T = E.TYPES[type];
    if (T.dip || T.row) return place(type, E.footprint(type, pt));
    if (!G.pending) {
      if (E.isTerminal(pt) && type !== "wire") return say("Only wires reach the supply's terminals.", true);
      if (occupied(pt)) return say(`${pt} already has a leg in it: one lead per hole.`, true);
      G.pending = pt; renderGhost(); say(toolHelp()); return;
    }
    if (pt === G.pending) { G.pending = null; renderGhost(); say(toolHelp()); return; }
    place(type, E.footprint(type, G.pending, pt));
  }
  function place(type, fp) {
    if (fp.error) return say(fp.error, true);
    const clash = Object.values(fp.pins).find((h) => occupied(h));
    if (clash) return say(`${clash} already has a leg in it: one lead per hole.`, true);
    const it = G.tool.item;
    const part = { id: it && it.ref ? it.ref : nextId(type), type, pins: fp.pins };
    if (type === "wire") part.color = autoColor(fp.pins);
    else { if (it.value !== undefined) part.value = it.value; if (it.color) part.color = it.color; it.left--; }
    G.parts.push(part);
    G.pending = null;
    changed();
    say(`${part.id} placed.`);
    if (it && it.left <= 0) setTool({ kind: "none" }); else say(toolHelp());
  }
  function removePart(p) {
    if (p.locked) return say(`${p.id} is glued down in this level.`, true);
    G.parts = G.parts.filter((q) => q !== p);
    if (kindOf(p) !== "wire") {
      if (p.burnt) say(`${p.id} was burnt out: it goes in the bin for good.`);
      else {
        const it = binItemFor(p);
        if (it) it.left++;
        say(`${p.id} back in the parts bin.`);
      }
    } else say(`${p.id} removed.`);
    delete G.pots[p.id]; delete G.pressed[p.id];
    changed();
  }
  /** The build plus the meter, when it's in amps mode: then it's a 0.1 ohm part of the circuit. */
  function meterState() { return { mode: G.meter.mode, blown: G.meter.blown, probes: G.probes.slice() }; }
  function simParts() { const m = E.meterPart(meterState()); return m ? [...G.parts, m] : G.parts; }
  function changed() {
    G.nets = E.buildNets(simParts());
    if (G.sim) { G.sim.rebuild(simParts()); G.sim.potPos = G.pots; G.sim.pressed = G.pressed; }
    G.probes = G.probes.filter((h) => E.isTerminal(h) || E.isHole(h));
    G.liveSig = null;                                          // nets changed: repaint the glow
    renderParts(); renderBin(); renderKnobs(); renderHover(); renderHintRings([]); updateMeter();
    renderTags();
    store.set("build:" + G.level.id, G.parts.filter((p) => !p.locked));
    snapshot();
  }

  // ------------------------------------------------------------------ power and the live loop
  function setPower(on) {
    G.power = on;
    $("power").setAttribute("aria-pressed", on);
    if (on) { G.sim = new E.Sim(simParts(), G.level.supply); G.sim.pressed = G.pressed; G.sim.potPos = G.pots; G.sim.sound = G.sound; G.last = performance.now(); }
    else G.sim = null;
    say(on ? "Power on. Buttons: press and hold. Pots: drag the knob slider in the parts panel." : "Power off.");
    updateLive(); updateMeter(); renderTags();
  }
  function loop(now) {
    if (G.sim) {
      const dt = Math.min(0.05, (now - (G.last || now)) / 1000);
      G.last = now;
      const steps = Math.max(1, Math.round(dt / G.sim.dt));
      for (let i = 0; i < steps; i++) G.sim.step();
      if (G.sim.burnedNow) {
        if (G.sim.burnedNow.includes("METER")) {
          G.meter.blown = true; sound("pop"); G.statusSticky = true;
          say("The meter's fuse blew! In amps mode it's a near-short; it went straight across the supply.", true);
          G.sim.burnedNow = G.sim.burnedNow.filter((x) => x !== "METER");
          changed(); renderMeterModes();
        }
        for (const id of G.sim.burnedNow) {
          const p = G.parts.find((q) => q.id === id);
          if (p) { p.burnt = true; smoke(p); sound("pop"); say(`${id} burned out! It took more than ${E.LED_MAX * 1000} mA.`, true); G.statusSticky = true; }
        }
        G.sim.burnedNow = null;
        renderParts();
        store.set("build:" + G.level.id, G.parts.filter((p) => !p.locked));
      }
      updateLive(); updateMeter();
      if (now - (G.lastTags || 0) > 125) { G.lastTags = now; renderTags(); }
    }
    requestAnimationFrame(loop);
  }
  function smoke(p) {
    const [a, b] = Object.values(p.pins).map(xy), x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
    const g = el("g", { class: "smoke", style: `transform-origin:${x}px ${y}px` }, L.fx);
    for (const [dx, dy, r] of [[0, -4, 6], [-5, -9, 5], [5, -11, 4.5]]) el("circle", { cx: x + dx, cy: y + dy, r, fill: "#9a9a9a", "fill-opacity": 0.8 }, g);
    setTimeout(() => g.remove(), 1700);
  }
  /* Powered strips glow with their voltage: ground cool blue (the − rail's colour), the supply's + warm red,
     anything between blended by its actual voltage. A strip with no path to the supply sits at 0 V in the
     solver but is NOT ground, so it stays dark: only the supply's − net glows blue at 0 V. */
  const COLD = [70, 140, 255], HOT = [255, 64, 48];
  function liveColor(t) { return `rgb(${COLD.map((c, i) => Math.round(c + (HOT[i] - c) * t)).join(",")})`; }
  function stripShape(key, fill, op) {
    const [kind, v] = key.split(":");
    if (kind === "term") { const [x, y] = TERM[v]; return `<circle cx="${x}" cy="${y}" r="15" fill="${fill}" opacity="${op}"/>`; }
    if (kind === "rail") { const y = OY + E.ROW_Y[v] * P; return `<rect x="${OX + 3.3 * P}" y="${y - 0.5 * P}" width="${59.4 * P}" height="${P}" rx="6" fill="${fill}" opacity="${op}"/>`; }
    const c = +v, x = OX + (c + 1) * P, [r0, r1] = kind === "top" ? ["a", "e"] : ["f", "j"];
    return `<rect x="${x - 0.5 * P}" y="${OY + (E.ROW_Y[r0] - 0.5) * P}" width="${P}" height="${(E.ROW_Y[r1] - E.ROW_Y[r0] + 1) * P}" rx="6" fill="${fill}" opacity="${op}"/>`;
  }
  function renderLive(force) {
    if (!G.sim) { if (G.liveSig) { L.live.innerHTML = ""; G.liveSig = ""; } return; }
    const gnd = G.nets.netOf("PSU.-"), vset = G.level.supply.v;
    const probe = (key) => { const [k, v] = key.split(":"); return k === "term" ? v : k === "rail" ? v + "3" : (k === "top" ? "a" : "f") + v; };
    let sig = "", out = "";
    for (const [net, keys] of G.nets.groups()) {
      const isGnd = net === gnd, v = G.sim.voltageAt(probe(keys[0]));
      if (!isGnd && v < 0.05) continue;                        // floating (or truly ~0 V but not ground): dark
      const t = isGnd ? 0 : Math.max(0, Math.min(1, v / vset));
      const q = Math.round(t * 40);
      sig += net + q + ";";
      const fill = liveColor(q / 40), op = isGnd ? 0.42 : 0.3 + 0.25 * (q / 40);
      out += keys.map((k) => stripShape(k, fill, op.toFixed(2))).join("");
    }
    if (force || sig !== G.liveSig) { L.live.innerHTML = out; G.liveSig = sig; }
  }
  // ------------------------------------------------------------------ readouts: volts on strips, current through parts
  const fmtV = (v) => (Math.abs(v) < 0.005 ? "0.00" : v.toFixed(2)) + " V";
  function fmtI(i) {
    const a = Math.abs(i);
    if (a < 1e-6) return "0 mA";
    if (a < 1e-3) return (i * 1000).toFixed(2) + " mA";
    if (a < 1) return (i * 1000).toFixed(1) + " mA";
    return i.toFixed(2) + " A";
  }
  let placed = [];                                             // probe-view tags placed this frame (for collisions)
  function tag(x, y, lines, big) {
    const fs = big ? 11 : 9.5, lh = fs * 1.25, w = Math.max(...lines.map((l) => l.length)) * fs * 0.62 + 10, h = lines.length * lh + 6;
    const clampX = (v) => Math.min(Math.max(4, v), SVGW - w - 4), clampY = (v) => Math.min(Math.max(4, v), SVGH - h - 4);
    let tx = clampX(x - w / 2), ty = clampY(y - h);
    if (!big) {                                                // try the spot, then step above/below until it's clear
      const hit = (a, b) => placed.some((r) => a < r[0] + r[2] + 2 && a + w + 2 > r[0] && b < r[1] + r[3] + 2 && b + h + 2 > r[1]);
      for (const k of [0, -1, 1, -2, 2, -3, 3]) { const yy = clampY(y - h + k * (h + 3)); if (!hit(tx, yy)) { ty = yy; break; } }
      placed.push([tx, ty, w, h]);
    }
    return `<g><rect x="${tx}" y="${ty}" width="${w}" height="${h}" rx="4" fill="#0d1415" fill-opacity=".93" stroke="${big ? "#ffb000" : "#3a4f53"}"/>` +
      lines.map((l, k) => `<text x="${tx + 5}" y="${ty + 3 + lh * (k + 0.8)}" font-family="JetBrains Mono, monospace" font-size="${fs}" fill="${k === 0 && big ? "#ffb000" : "#e4ece8"}">${esc(l)}</text>`).join("") + `</g>`;
  }
  const mid = (p) => { const pts = Object.values(p.pins).map(xy); return [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length]; };
  function partLines(p) {
    const r = G.sim.reading(p.id);
    if (!r) return null;
    const k = kindOf(p);
    const name = k === "resistor" ? `${p.id} ${fmtR(p.value)}` : k === "led" ? `${p.id} ${p.color || "red"} LED` :
      k === "capacitor" ? `${p.id} ${fmtC(p.value)}` : p.id;
    if (k === "pot") return [`${p.id} ${fmtR(p.value)}`, `wiper ${fmtV(r.vw)}`, `ends ${fmtV(r.v1)} / ${fmtV(r.v3)}`, `track ${fmtI(r.iTop)}`];
    if (k === "comparator") return [`${p.id} ${partOf(p).chip}`, ...r.channels.map((c, i) => `${"AB"[i]}: ${c.off ? "off" : "pulling low"} (+${fmtV(c.vp)} / −${fmtV(c.vn)})`)];
    if (k === "tone") return [`${p.id} tone source`, `sound: ${r.sound}`, `OUT ${fmtV(r.vout)}`];
    if (k === "logicin") return [`${p.id} ${partOf(p).pins[0].name}`, `${r.level}`, fmtV(r.v)];
    if (k === "ne555") return [`${p.id} ${partOf(p).chip || "555"}`, `output ${r.q ? "HIGH" : "LOW"} ${fmtV(r.vout)}`, `VCC ${fmtV(r.vcc)}`];
    if (k === "led" && p.burnt) return [name, "burnt out: open circuit"];
    if (k === "button") return [`${p.id} ${G.pressed[p.id] ? "pressed" : "open"}`, fmtI(r.i), `${fmtV(r.v)} across`];
    return [name, fmtI(r.i), `${fmtV(r.v)} across`];
  }
  function stripAnchor(key) {                                  // where a strip's readout sits: just outside the strip
    const [kind, v] = key.split(":");
    if (kind === "term") { const [x, y] = TERM[v]; return [x, y - 16]; }
    if (kind === "rail") return [OX + 1.8 * P, OY + E.ROW_Y[v] * P + 5];
    const x = OX + (+v + 1) * P;
    return kind === "top" ? [x, OY + E.ROW_Y.a * P - 5] : [x, OY + E.ROW_Y.j * P + 22];
  }
  function renderTags() {
    if (!G.sim) { L.tags.innerHTML = ""; return; }
    let out = "";
    placed = [];
    if (G.probeView) {
      const gnd = G.nets.netOf("PSU.-");
      for (const [net, keys] of G.nets.groups()) {
        const v = G.sim.voltageAt(keys[0].startsWith("term:") ? keys[0].slice(5) : (() => { const [k, c] = keys[0].split(":"); return k === "rail" ? c + "3" : (k === "top" ? "a" : "f") + c; })());
        if (net !== gnd && v < 0.05) continue;
        const key = keys.find((k) => k.startsWith("top:") || k.startsWith("bot:")) || keys.find((k) => k.startsWith("rail:")) || keys[0];
        const [x, y] = stripAnchor(key);
        out += tag(x, y, [fmtV(v)]);
      }
      for (const p of G.parts) {
        if (kindOf(p) === "wire") continue;
        const lines = partLines(p);
        if (!lines) continue;
        const [x, y] = mid(p);
        out += tag(x, y - 10, ["pot", "ne555"].includes(kindOf(p)) ? lines.slice(1, 2) : [lines[1]]);
      }
    }
    if (G.hoverXY) {                                            // hover: the full story for one thing
      const p = G.tool.kind === "none" || G.tool.kind === "meter" ? partAt(...G.hoverXY) : null;
      if (p && kindOf(p) !== "wire") { const [x, y] = mid(p), lines = partLines(p); if (lines) out += tag(x, y - 14, lines, true); }
      else if (G.hover) {
        const [x, y] = xy(G.hover);
        out += tag(x, y - 9, [`${fmtV(G.sim.voltageAt(G.hover))}`, E.describeStrip(E.stripOf(G.hover))], true);
      }
    }
    L.tags.innerHTML = out;
  }
  function updateLive() {
    const S = G.level ? G.level.supply : { v: 5, ilim: 0.1 };
    L.psuSet.textContent = `SET ${S.v.toFixed(2)} V  ${S.ilim.toFixed(2)} A`;
    if (!G.sim) {
      L.psuV.textContent = "OFF"; L.psuI.textContent = "–.––– A"; L.psuMode.textContent = "";
      for (const n of [L.psuV, L.psuI, L.psuMode]) n.setAttribute("fill", "#6b4a00");
      L.psuOut.setAttribute("fill", "#233");
      renderLive();
      for (const p of G.parts) if (kindOf(p) === "led") { const g = document.getElementById("glow-" + p.id); if (g) g.setAttribute("opacity", 0); }
      return;
    }
    renderLive();
    const r = G.sim.supplyReading();
    L.psuV.textContent = r.v.toFixed(2) + " V"; L.psuI.textContent = r.i.toFixed(3) + " A"; L.psuMode.textContent = r.mode;
    for (const n of [L.psuV, L.psuI]) n.setAttribute("fill", "#ffb000");
    L.psuMode.setAttribute("fill", r.mode === "CC" ? "#ff5a4f" : "#3ddc84");
    L.psuOut.setAttribute("fill", "#3ddc84");
    for (const p of G.parts) if (kindOf(p) === "logicin") {
      const el = document.getElementById("io-" + p.id), r = G.sim.reading(p.id);
      if (el) el.setAttribute("fill", r.level === "HIGH" ? "#3ddc84" : r.level === "LOW" ? "#233" : "#8a6d1a");
    }
    for (const p of G.parts) if (kindOf(p) === "led") {
      const i = G.sim.current(p.id), g = document.getElementById("glow-" + p.id), c = document.getElementById("core-" + p.id);
      const k = Math.max(0, Math.min(1, i / 0.012));
      if (g) g.setAttribute("opacity", (Math.sqrt(k) * 0.95).toFixed(3));
      if (c) c.setAttribute("opacity", (0.35 + 0.6 * k).toFixed(3));
    }
  }
  function updateMeter(fresh) {
    const lcd = $("meter-lcd"), sub = $("meter-sub");
    lcd.classList.remove("beep");
    if (G.meter.mode === "A" && G.meter.blown) { lcd.textContent = "FUSE"; sub.textContent = "fuse blown: replace it, then measure in series"; return; }
    if (G.probes.length < 2) { lcd.textContent = "– – –"; sub.textContent = G.tool.kind === "meter" ? toolHelp() : "pick the Meter, then click two holes"; return; }
    const [a, b] = G.probes;
    if (G.meter.mode === "A") {
      const i = G.sim ? G.sim.current("METER") : 0;
      lcd.textContent = (i < 0 ? "−" : " ") + (Math.abs(i) * 1000).toFixed(2) + " mA";
      sub.textContent = `DC amps: through the meter, red ${a} → black ${b}`;
      return;
    }
    if (!G.sim) {
      const same = G.nets.netOf(a) === G.nets.netOf(b);
      lcd.textContent = same ? "0.0 Ω  ))) " : "OL";
      if (same) lcd.classList.add("beep");
      sub.textContent = same ? `continuity: ${a} and ${b} are connected` : `continuity: ${a} and ${b} are not connected`;
      if (fresh && same) sound("beep");
      return;
    }
    const v = G.sim.voltageAt(a) - G.sim.voltageAt(b);
    lcd.textContent = (v >= 0 ? " " : "") + v.toFixed(2) + " V";
    sub.textContent = `DC volts: red on ${a}, black on ${b}`;
  }

  // ------------------------------------------------------------------ sound (starts from a click, so browsers allow it)
  let ac;
  function sound(kind) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      if (kind === "beep") { o.frequency.value = 2700; g.gain.setValueAtTime(0.06, t); g.gain.setValueAtTime(0, t + 0.18); o.start(t); o.stop(t + 0.2); }
      if (kind === "pop") { o.type = "sawtooth"; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.start(t); o.stop(t + 0.32); }
      if (kind === "win") { o.type = "square"; [523, 659, 784, 1047].forEach((f, i) => o.frequency.setValueAtTime(f, t + i * 0.11)); g.gain.setValueAtTime(0.04, t); g.gain.setValueAtTime(0, t + 0.5); o.start(t); o.stop(t + 0.52); }
    } catch (e) { /* no audio: carry on */ }
  }

  // ------------------------------------------------------------------ checking
  function check() {
    const lv = G.level, R = $("result");
    if (!lv.goal) { R.className = "result"; R.innerHTML = `<h3>Sandbox</h3><p>No goal here. Power it on and watch what it does.</p>`; return; }
    const res = E.checkGoal(G.parts, lv, { pots: G.pots, meter: meterState() });
    if (res.ok) {
      G.solved[lv.id] = true; store.set("solved", G.solved); renderLevels(); renderHintRings([]); sound("win");
      const next = ALL[G.li + 1];
      R.className = "result ok";
      R.innerHTML = `<h3>Level complete</h3><p>${esc(res.why)}</p><p class="lesson">${esc(lv.lesson)}</p>` +
        `<div class="actions">${next ? `<button class="primary" id="next">Next: ${esc(next.title)} →</button>` : ""}</div>`;
      if (next) $("next").onclick = () => loadLevel(G.li + 1);
      return;
    }
    G.hints = E.diagnose(simParts(), lv); G.hintStep = 0;
    showFail(res.why);
  }
  function showFail(why) {
    const R = $("result"), h = G.hints[0];
    R.className = "result fail";
    let html = `<h3>Not yet</h3><p>${esc(why)}</p>`;
    if (h) {
      html += `<div class="hint">${h.text.slice(0, G.hintStep + 1).map((t) => `<p>${esc(t)}</p>`).join("")}</div>`;
      if (G.hints.length > 1) html += `<p class="lesson">Fix this first; ${G.hints.length - 1} more thing${G.hints.length > 2 ? "s" : ""} to look at after.</p>`;
    } else html += `<div class="hint"><p>Nothing looks miswired. The line above says what the circuit is doing now; adjust from there, or compare it to the schematic leg by leg.</p></div>`;
    html += `<div class="actions">${h && G.hintStep < 2 ? `<button id="more">More help</button>` : ""}</div>`;
    R.innerHTML = html;
    renderHintRings(h && G.hintStep >= 2 ? h.holes.filter((x) => E.isTerminal(x) || E.isHole(x)) : []);
    const m = $("more"); if (m) m.onclick = () => { G.hintStep++; showFail(why); };
  }
  function idleResult() {
    const R = $("result");
    R.className = "result";
    R.innerHTML = G.level.goal ? `<h3>Goal</h3><p>${esc(goalText(G.level.goal))}</p><p class="lesson">Build it, power it on to try it, then press Check.</p>`
      : `<h3>Sandbox</h3><p>No goal: build anything and power it on.</p>`;
  }
  function goalText(g) {
    const mA = (i) => Math.round(i * 1000) + " mA";
    if (g.kind === "all") return g.of.map(goalText).filter(Boolean).join(" Then: ");
    if (g.kind === "netlist") return "Wire it the way the Connections list says: every net joined, nothing else joined to it.";
    if (g.kind === "lit") return `Light ${g.count > 1 ? "both LEDs" : "the LED"} at ${mA(g.min)}–${mA(g.max)}, without burning anything out.`;
    if (g.kind === "button") return "The LED lights only while the button is held.";
    if (g.kind === "dimmer") return `Turning the knob end to end changes the brightness at least ${g.ratio}×, and never above ${mA(g.max)}.`;
    if (g.kind === "blink") return `The LED flashes at ${g.fmin}–${g.fmax} Hz.`;
    if (g.kind === "divider") return `Wire the pot as a voltage divider and set its wiper to ${g.target} V (±${g.tol}), checked with the meter.`;
    return "";
  }

  // ------------------------------------------------------------------ sidebar
  function miniIcon(it) {
    const c = it.color ? `rgb(${E.LED_COLORS[it.color].rgb})` : "";
    switch (drawOf(it)) {
      case "resistor": return `<svg viewBox="0 0 30 18"><line x1="0" y1="9" x2="30" y2="9" stroke="#999" stroke-width="1.5"/><rect x="7" y="5" width="16" height="8" rx="4" fill="#e3c59b"/>${bands(it.value).slice(0, 3).map((b, i) => `<rect x="${10 + i * 3.4}" y="5" width="1.8" height="8" fill="${b}"/>`).join("")}</svg>`;
      case "led": return `<svg viewBox="0 0 30 18"><line x1="10" y1="12" x2="10" y2="18" stroke="#999"/><line x1="20" y1="14" x2="20" y2="18" stroke="#999"/><circle cx="15" cy="8" r="7" fill="${c}"/></svg>`;
      case "button": return `<svg viewBox="0 0 30 18"><rect x="8" y="2" width="14" height="14" rx="2" fill="#222"/><circle cx="15" cy="9" r="4.5" fill="#b8b8b8"/></svg>`;
      case "pot": return `<svg viewBox="0 0 30 18"><rect x="5" y="2" width="20" height="14" rx="2" fill="#1f5fae"/><circle cx="15" cy="9" r="5" fill="#f2f2f2"/></svg>`;
      case "module": return `<svg viewBox="0 0 30 18"><rect x="3" y="2" width="24" height="12" rx="2" fill="${(partOf(it).board || {}).color || "#1f4fa3"}"/>${[8, 15, 22].map((x) => `<rect x="${x}" y="14" width="2" height="4" fill="#bbb"/>`).join("")}</svg>`;
      case "dip": return `<svg viewBox="0 0 30 18"><rect x="4" y="4" width="22" height="10" rx="1" fill="#262626"/>${[7, 12, 17, 22].map((x) => `<rect x="${x}" y="1" width="2" height="3" fill="#bbb"/><rect x="${x}" y="14" width="2" height="3" fill="#bbb"/>`).join("")}</svg>`;
      case "electrolytic": return `<svg viewBox="0 0 30 18"><circle cx="15" cy="9" r="7.5" fill="#1d3f8f"/><path d="M18,2.5 A7.5,7.5 0 0,1 18,15.5 Z" fill="#c7d3ee"/></svg>`;
      case "capacitor": return `<svg viewBox="0 0 30 18"><ellipse cx="15" cy="8" rx="6" ry="5" fill="#d99a2b"/></svg>`;
      case "diode": return `<svg viewBox="0 0 30 18"><line x1="0" y1="9" x2="30" y2="9" stroke="#999"/><rect x="8" y="6" width="14" height="6" rx="2" fill="#e9a07a"/><rect x="18" y="6" width="2" height="6" fill="#222"/></svg>`;
    }
    return "";
  }
  function renderBin() {
    const intro = new Set((G.level.cards || []).map((c) => c.id));
    const box = $("bin");
    box.innerHTML = "";
    G.bin.filter((it) => kindOf(it) !== "wire").forEach((it) => {
      const b = document.createElement("button");
      const on = G.tool.kind === "place" && G.tool.item === it;
      b.setAttribute("aria-pressed", on);
      b.disabled = it.left <= 0;
      b.innerHTML = `${miniIcon(it)}<span>${it.ref ? `<b>${esc(it.ref)}</b> · ` : ""}${esc(itemLabel(it))}<br><span class="count">${it.left === Infinity ? "∞" : "×" + it.left}</span></span>` +
        (intro.has(C.FOR_PART[it.type]) && !G.level.sandbox && !G.level.circuit ? `<span class="new">NEW</span>` : "");
      b.onclick = () => { setTool(on ? { kind: "none" } : { kind: "place", item: it }); if (!on) showCard(C.FOR_PART[it.type], variantOf(it)); };
      box.appendChild(b);
    });
    if (!box.children.length) box.innerHTML = `<p class="lesson" style="margin:0;grid-column:1/-1">Wires only in this level: use the Wire tool.</p>`;
  }
  function renderKnobs() {
    const pots = G.parts.filter((p) => kindOf(p) === "pot");
    $("knobs").innerHTML = pots.map((p) => `<label for="knob-${esc(p.id)}">${esc(p.id)}<input type="range" id="knob-${esc(p.id)}" min="0" max="1000" value="${Math.round((G.pots[p.id] ?? 0.5) * 1000)}"></label>`).join("");
    for (const p of pots) $("knob-" + p.id).oninput = (ev) => { G.pots[p.id] = ev.target.value / 1000; renderParts(); };
    const mics = G.parts.filter((p) => kindOf(p) === "tone");
    if (mics.length) {
      $("knobs").insertAdjacentHTML("beforeend", `<div class="sound" role="radiogroup" aria-label="Sound at the microphone"><span>Sound</span>` +
        ["off", "talk", "horn"].map((v) => `<button role="radio" aria-checked="${G.sound === v}" data-sound="${v}">${v}</button>`).join("") + `</div>`);
      $("knobs").querySelectorAll("[data-sound]").forEach((b) => { b.onclick = () => { G.sound = b.dataset.sound; if (G.sim) G.sim.sound = G.sound; renderKnobs(); say(`The tone source is now playing: ${G.sound}.`); }; });
    }
    $("knobs").style.marginTop = pots.length || mics.length ? "10px" : "0";
  }
  function renderLevels() {
    const nav = $("levels");
    nav.innerHTML = "";
    const row = (label, cls) => { const r = document.createElement("div"); r.className = "levelrow " + cls; if (label) r.innerHTML = `<span class="rowlbl">${label}</span>`; nav.appendChild(r); return r; };
    const main = row("", "lv-main"), ex = row("Examples", "ex"), yours = row("Your circuits", "yours");   // not "main": that's the page grid
    let e = 0, y = 0;
    ALL.forEach((lv, i) => {
      const b = document.createElement("button");
      const tag = lv.group === "examples" ? "E" + ++e : lv.group === "yours" ? "★" : lv.sandbox ? "S" : String(i + 1);
      b.innerHTML = `<span class="n">${tag}${lv.boss ? " BOSS" : ""}${G.solved[lv.id] ? " ✓" : ""}</span>${esc(lv.title)}`;
      if (G.solved[lv.id]) b.classList.add("done");
      if (lv.boss) b.classList.add("boss");
      b.setAttribute("aria-current", i === G.li);
      b.onclick = () => loadLevel(i);
      (lv.group === "examples" ? ex : lv.group === "yours" ? yours : main).appendChild(b);
      if (lv.group === "yours") y++;
    });
    const imp = document.createElement("button");
    imp.className = "import"; imp.innerHTML = `<span class="n">+</span>Import a circuit…`;
    imp.title = "Load a circuit file (.yaml, .json) or a KiCad netlist (.net), or drop one anywhere on the page";
    imp.onclick = () => $("import-file").click();
    yours.appendChild(imp);
  }
  function renderMission() {
    const lv = G.level, n = lv.sandbox ? "" : `<span class="lv">${lv.boss ? `<span class="boss">BOSS</span> · ` : ""}Level ${G.li + 1} · </span>`;
    const sch = lv.schematic && SCH[lv.schematic];
    const lvTag = lv.group === "examples" ? `<span class="lv">Example · </span>` : lv.group === "yours" ? `<span class="lv">Your circuit · </span>` : n;
    $("mission").innerHTML = `<h2>${lvTag}${esc(lv.title)}</h2>` + (lv.about ? `<p class="lesson">${esc(lv.about)}</p>` : "") +
      `<ol>${lv.brief.map((b) => `<li>${esc(b)}</li>`).join("")}</ol>` +
      (sch ? `<figure class="schem" id="schem" tabindex="0" title="Click to enlarge"><img alt="Schematic for ${esc(lv.title)}" src="${sch}"><figcaption>The schematic. Click to enlarge.</figcaption></figure>` : "") +
      (lv.nets ? `<p class="eyebrow" style="margin-top:12px">Connections (the netlist)</p><table class="netlist"><tbody>` +
        Object.entries(lv.nets).map(([k, pins]) => `<tr><th>${esc(k)}</th><td>${pins.map((p) => `<code>${esc(p)}</code>`).join(" ")}</td></tr>`).join("") +
        `</tbody></table>` : "") +
      (lv.group === "yours" ? `<button class="linkish" id="forget-circuit">Remove this circuit</button>` : "");
    const fg = $("forget-circuit"); if (fg) fg.onclick = () => forgetCircuit(lv.id);
    const f = $("schem"); if (f) f.onclick = f.onkeydown = (ev) => { if (ev.type === "keydown" && ev.key !== "Enter") return; f.classList.toggle("big"); };
    G.cardView = null; G.cardPage = 0;
    renderCards();
  }
  /* The card panel: the level's new cards (paged), or the card for whatever you just picked or clicked. */
  function variantOf(p) { return { value: p.value, color: p.color }; }
  function showCard(id, v) { G.cardView = { id, v: v || {} }; collect([id]); renderCards(); }
  function renderCards() {
    const np = $("newparts"), lv = G.level, own = lv.cards || [];
    let head, body, pager = "";
    if (G.cardView) {
      head = `<p class="eyebrow">Card</p>`;
      body = C.cardHTML(G.cardView.id, G.cardView.v, SCH);
      if (own.length) pager = `<button class="linkish" id="card-back">← this level's new card${own.length > 1 ? "s" : ""}</button>`;
    } else if (own.length) {
      const k = Math.min(G.cardPage, own.length - 1), c = own[k];
      head = `<p class="eyebrow">New in this level${own.length > 1 ? ` · ${k + 1} of ${own.length}` : ""}</p>`;
      body = C.cardHTML(c.id, c, SCH);
      if (own.length > 1) pager = `<div class="pager"><button id="card-prev" aria-label="Previous card"${k === 0 ? " disabled" : ""}>←</button><button id="card-next" aria-label="Next card"${k === own.length - 1 ? " disabled" : ""}>→</button></div>`;
    } else { np.hidden = true; return; }
    np.hidden = false;
    np.innerHTML = head + `<div class="cardslot">${body}</div>` + pager;
    const on = (id, f) => { const b = $(id); if (b) b.onclick = f; };
    on("card-back", () => { G.cardView = null; renderCards(); });
    on("card-prev", () => { G.cardPage--; renderCards(); });
    on("card-next", () => { G.cardPage++; renderCards(); });
  }
  function collect(ids) {
    let added = false;
    for (const id of ids) if (C.BY_ID[id] && !G.collected.has(id)) { G.collected.add(id); added = true; }
    if (added) { store.set("cards", [...G.collected]); }
    $("binder-count").textContent = `${G.collected.size}/${C.CARDS.length}`;
  }
  function openBinder() {
    const unlockAt = {};
    ALL.forEach((lv, i) => (lv.cards || []).forEach((c) => { if (!(c.id in unlockAt)) unlockAt[c.id] = lv.sandbox ? "the Sandbox" : `level ${i + 1}`; }));
    $("binder-grid").innerHTML = C.CARDS.map((c) => G.collected.has(c.id) ? C.cardHTML(c.id, {}, SCH) : C.cardBack(`Unlocks in ${unlockAt[c.id] || "a later set"}`)).join("");
    $("binder").hidden = false; $("binder-close").focus();
  }
  function renderMeterModes() {
    $("mode-v").setAttribute("aria-pressed", G.meter.mode === "V");
    $("mode-a").setAttribute("aria-pressed", G.meter.mode === "A");
    $("fuse").hidden = !G.meter.blown;
  }
  function setMeterMode(m) {
    G.meter.mode = m; renderMeterModes(); renderProbes(); changed();
    if (m === "A") showCard("ammeter"); else showCard("meter");
    say(m === "A" ? "Amps mode: the meter is now a 0.1 Ω part of the circuit wherever its probes are." : "Volts mode: the meter only looks; it draws nothing.");
  }

  // ------------------------------------------------------------------ levels
  function loadLevel(i, saved) {
    setPower(false);
    if (!ALL[i]) i = 0;                                          // a stale index (a removed circuit, an old save): start at the top
    G.li = i; G.level = ALL[i]; G.pressed = {}; G.pots = {}; G.probes = []; G.hints = []; G.pending = null;
    const preset = (G.level.preset || []).map((p) => ({ ...p, pins: { ...p.pins }, locked: !p.free }));
    const stored = saved || store.get("build:" + G.level.id, null);
    const own = (stored || preset.filter((p) => !p.locked)).filter((p) => p && E.TYPES[p.type] && Object.values(p.pins).every((h) => E.isTerminal(h) || E.isHole(h)));
    G.parts = [...preset.filter((p) => p.locked), ...own.map((p) => ({ ...p, locked: false }))];
    G.meter = { mode: "V", blown: false };
    collect((G.level.cards || []).map((c) => c.id));
    G.bin = G.level.bin.map((b) => ({ ...b, left: b.count }));
    for (const p of own) {
      if (kindOf(p) === "wire") continue;
      const it = binItemFor(p);
      if (it) it.left--;
    }
    visit(G.level.id);
    renderLevels(); renderMission(); setTool({ kind: "none" }); renderProbes(); renderMeterModes(); idleResult(); renderCalcs();
    changed();
    store.set("level", i);
  }

  /** The bin item a placed part came from: by designator on a circuit level, else by type/value/colour. */
  function binItemFor(p) {
    return G.bin.find((b) => b.ref === p.id) || G.bin.find((b) => !b.ref && b.type === p.type && b.value === p.value && (b.color || null) === (p.color || null));
  }

  // ------------------------------------------------------------------ your circuits: import a file, keep it, play it
  function loadImported() {
    IMPORTED = [];
    for (const f of store.get("imported", [])) {
      try { const doc = CI.parse(f.text); if (!CI.validate(doc).length) IMPORTED.push(CI.toLevel(doc, { id: f.id, group: "yours" })); } catch (e) { /* skip a file that no longer parses */ }
    }
    rebuildAll();
  }
  function importText(text, name, notes) {
    if (/^\s*\(export/.test(text)) return importKiCad(text, name);   // a KiCad netlist: convert it first
    let doc;
    try { doc = CI.parse(text); } catch (e) { return importError(name, [`It isn't valid YAML or JSON: ${e.message.split("\n")[0]}`], text); }
    const errs = CI.validate(doc);
    if (errs.length) return importError(name, errs, text, notes);
    const id = "yours-" + (doc.title || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const files = store.get("imported", []).filter((f) => f.id !== id).concat([{ id, text }]);
    store.set("imported", files);
    loadImported();
    renderLevels();
    loadLevel(ALL.findIndex((l) => l.id === id));
    say(`Loaded "${doc.title}" from ${name}.`);
    if (notes && notes.length) {
      const R = $("result"); R.className = "result";
      R.innerHTML = `<h3>Imported from KiCad, with notes</h3><ul class="errs">${notes.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`;
    }
  }
  function importKiCad(text, name) {
    let r;
    try { r = window.BenchKiCad.convert(text, {}); } catch (e) { return importError(name, [`Couldn't read the KiCad netlist: ${e.message}`]); }
    if (r.ok) return importText(r.yaml, name.replace(/\.net$/i, ".yaml"), r.warnings);
    importError(name, r.warnings, r.yaml, null, "Converted from KiCad, but it needs you first");
  }
  /** Problems with a file, and the file itself in an editor: fix it here and load it. */
  function importError(name, errs, text, notes, heading) {
    const R = $("result");
    R.className = "result fail";
    R.innerHTML = `<h3>${esc(heading || `Couldn't load ${name}`)}</h3><ul class="errs">${errs.map((e) => { const k = e.split(":")[0]; return /^[\w.+\-\s]+$/.test(k) && k.length < 40 ? `<li><code>${esc(k)}</code>${esc(e.slice(k.length))}</li>` : `<li>${esc(e)}</li>`; }).join("")}</ul>` +
      (text !== undefined ? `<label class="eyebrow" for="draft">The circuit file: edit it here, then load it</label><textarea id="draft" spellcheck="false">${esc(text)}</textarea>` +
        `<div class="actions"><button class="primary" id="draft-load">Load it</button><button id="draft-copy">Copy</button></div>` : "") +
      `<p class="lesson">Formats: docs/CIRCUITS.md and docs/KICAD.md. Worked examples: examples/.</p>`;
    const L = $("draft-load"); if (L) L.onclick = () => importText($("draft").value, name.replace(/\.net$/i, ".yaml"));
    const C = $("draft-copy"); if (C) C.onclick = async () => { try { await navigator.clipboard.writeText($("draft").value); say("Copied the circuit file."); } catch (e) { $("draft").select(); say("Selected: press Ctrl+C to copy."); } };
    R.scrollIntoView({ block: "nearest" });
  }
  function forgetCircuit(id) {
    store.set("imported", store.get("imported", []).filter((f) => f.id !== id));
    loadImported(); renderLevels(); loadLevel(0);
    say("Circuit removed from this browser.");
  }
  function wireImport() {
    const inp = $("import-file");
    inp.onchange = async () => { const f = inp.files[0]; if (f) importText(await f.text(), f.name); inp.value = ""; };
    let depth = 0;
    const over = (on) => document.body.classList.toggle("dropping", on);
    window.addEventListener("dragenter", (ev) => { if ([...ev.dataTransfer.types].includes("Files")) { depth++; over(true); ev.preventDefault(); } });
    window.addEventListener("dragover", (ev) => { if ([...ev.dataTransfer.types].includes("Files")) ev.preventDefault(); });
    window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; over(false); } });
    window.addEventListener("drop", async (ev) => {
      depth = 0; over(false);
      const f = ev.dataTransfer.files[0];
      if (!f) return;
      ev.preventDefault();
      importText(await f.text(), f.name);
    });
  }

  function snapshot() { try { window.claude?.hot?.snapshot?.(() => ({ li: G.li, parts: G.parts.filter((p) => !p.locked) })); } catch (e) { /* not hosted */ } }

  function boot(data) {
    buildSVG();
    const sw = $("swatches");
    for (const c of ["yellow", "green", "blue", "orange", "white", "red", "black"]) {
      const b = document.createElement("button");
      b.style.background = WIRE[c]; b.title = c + " wire"; b.setAttribute("aria-label", c + " wire"); b.setAttribute("aria-pressed", c === G.wireColor);
      b.onclick = () => { G.wireColor = c; [...sw.children].forEach((x) => x.setAttribute("aria-pressed", x === b)); setTool({ kind: "wire" }); };
      sw.appendChild(b);
    }
    $("power").onclick = () => setPower(!G.power);
    const probeView = (on) => { G.probeView = on; $("probe").setAttribute("aria-pressed", on); renderTags();
      if (on && !G.sim) say("Probe view shows readings while the power is on (P)."); };
    $("probe").onclick = () => probeView(!G.probeView);
    G.toggleProbe = () => probeView(!G.probeView);
    $("tool-wire").onclick = () => setTool(G.tool.kind === "wire" ? { kind: "none" } : { kind: "wire" });
    $("tool-meter").onclick = () => { const on = G.tool.kind === "meter"; setTool(on ? { kind: "none" } : { kind: "meter" }); if (!on) showCard(G.meter.mode === "A" ? "ammeter" : "meter"); };
    $("mode-v").onclick = () => setMeterMode("V");
    $("mode-a").onclick = () => setMeterMode("A");
    $("fuse").onclick = () => { G.meter.blown = false; renderMeterModes(); changed(); say("New fuse in. In amps mode the meter goes in the gap, in series."); };
    $("binder-open").onclick = openBinder;
    $("rulebook-open").onclick = () => openRulebook();
    // the logo triangle: cover a letter, read what's left
    const TRI = { V: "V = I × R  ·  I and R side by side: multiply", I: "I = V ÷ R  ·  V over R: divide", R: "R = V ÷ I  ·  V over I: divide" };
    const tag = $("tagline"), tagDefault = tag.textContent, tri = document.querySelector(".tri");
    tri.querySelectorAll("[data-f]").forEach((g) => {
      const show = () => { tag.textContent = TRI[g.dataset.f]; tag.classList.add("formula"); tri.classList.add("covering"); };
      const hide = () => { tag.textContent = tagDefault; tag.classList.remove("formula"); tri.classList.remove("covering"); };
      g.onmouseenter = g.onfocus = show; g.onmouseleave = g.onblur = hide;
      g.onclick = () => openRulebook("ohm");
      g.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openRulebook("ohm"); } };
    });
    $("rulebook-close").onclick = () => { $("rulebook").hidden = true; };
    $("rulebook").onclick = (ev) => { if (ev.target.id === "rulebook") $("rulebook").hidden = true; };
    const setLabels = (on) => { G.labels = on; store.set("labels", on); svg.classList.toggle("nolabels", !on); $("labels").setAttribute("aria-pressed", on); };
    $("labels").onclick = () => setLabels(!G.labels);
    G.toggleLabels = () => setLabels(!G.labels);
    setLabels(store.get("labels", true));
    $("binder-close").onclick = () => { $("binder").hidden = true; };
    $("binder").onclick = (ev) => { if (ev.target.id === "binder") $("binder").hidden = true; };
    $("tool-remove").onclick = () => setTool(G.tool.kind === "remove" ? { kind: "none" } : { kind: "remove" });
    $("clear").onclick = () => {
      for (const p of G.parts.filter((q) => !q.locked && kindOf(q) !== "wire" && !q.burnt)) {
        const it = binItemFor(p); if (it) it.left++;
      }
      G.parts = G.parts.filter((p) => p.locked); G.pots = {}; G.pressed = {}; changed(); say("Board cleared.");
    };
    $("check").onclick = check;
    window.addEventListener("keydown", (ev) => {
      if (ev.target.closest && ev.target.closest("input")) return;
      const k = ev.key.toLowerCase();
      if (k === "escape") { $("schem")?.classList.remove("big"); $("binder").hidden = true; $("rulebook").hidden = true; setTool({ kind: "none" }); }
      else if (k === "p") setPower(!G.power);
      else if (k === "w") setTool(G.tool.kind === "wire" ? { kind: "none" } : { kind: "wire" });
      else if (k === "m") setTool(G.tool.kind === "meter" ? { kind: "none" } : { kind: "meter" });
      else if (k === "v") G.toggleProbe();
      else if (k === "l") G.toggleLabels();
      else if (k === "x") setTool(G.tool.kind === "remove" ? { kind: "none" } : { kind: "remove" });
    });
    loadImported(); wireImport();
    const start = data && Number.isInteger(data.li) ? data.li : store.get("level", 0);
    loadLevel(Math.min(Math.max(0, start), ALL.length - 1), data && data.parts);
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ calculators (left of the board) and the Rulebook
  const K = window.BenchCalc, RB = window.BenchRules;
  const levelNo = (id) => ALL.findIndex((l) => l.id === id) + 1;
  const unlocked = (levelId) => G.visited.has(levelId);
  const CALCS = [
    { id: "led", title: "LED resistor", unlock: "light", why: "ledres", formula: "R = (Vs − n·Vf) ÷ I",
      fields: [["vs", "Supply", "5", "V"], ["vf", "LED forward voltage", "2.0", "V"], ["n", "LEDs in series", "1", "", "series"], ["i", "Current", "10m", "A"]],
      out: (v) => {
        const r = K.ledResistor(v.vs, v.vf, v.i, v.n || 1);
        if (!r.ok) return [["The LEDs need more voltage than the supply has.", "", "bad"]];
        return [["R", K.fmt(r.r, "Ω"), "big"], ["next standard up", K.fmt(r.std, "Ω")], ["current with it", K.fmt(r.iStd, "A")],
                ["heat in it", K.fmt(r.p, "W") + (r.p < 0.25 ? " (fine for ¼ W)" : " (over ¼ W!)")]];
      } },
    { id: "ohm", title: "Ohm's law", unlock: "light", why: "ohm", formula: "V = I × R · leave one blank",
      fields: [["V", "Voltage", "", "V"], ["I", "Current", "9.1m", "A"], ["R", "Resistance", "330", "Ω"]],
      out: (v, raw) => {
        const blank = ["V", "I", "R"].filter((k) => raw[k].trim() === "");
        if (blank.length !== 1) return [["Fill in two, leave one blank.", "", "dim"]];
        const r = K.ohm(v.V, v.I, v.R), k = blank[0], unit = { V: "V", I: "A", R: "Ω" }[k];
        return [[k, K.fmt(r[k], unit), "big"], ["power", K.fmt(r.P, "W")]];
      } },
    { id: "rc", title: "R × C", unlock: "rctime", why: "timeconst", formula: "τ = R × C (Ω × F = s)",
      fields: [["R", "Resistance", "1k", "Ω"], ["C", "Capacitance", "1000u", "F"]],
      out: (v) => { const r = K.rc(v.R, v.C);
        return [["τ", K.fmt(r.tau, "s"), "big"], ["after τ", "37% left (⅔ drained)"], ["fade to a fifth", K.fmt(r.fifth, "s") + " (1.6 τ)"], ["5 τ", K.fmt(r.five, "s") + " (99% drained)"]]; } },
    { id: "one", title: "555 one-shot", unlock: "oneshot", why: "charging", formula: "t = R × C × ln 3 ≈ 1.1 RC",
      fields: [["R", "Timing resistor", "100k", "Ω"], ["C", "Timing capacitor", "10u", "F"]],
      out: (v) => [["on for", K.fmt(K.oneshot(v.R, v.C).t, "s"), "big"]] },
    { id: "ast", title: "555 astable", unlock: "blink", why: "astable", formula: "f = 1.44 ÷ ((R1 + 2·R2) × C)",
      fields: [["R1", "R1", "10k", "Ω"], ["R2", "R2", "68k", "Ω"], ["C", "C", "10u", "F"]],
      out: (v) => { const a = K.astable(v.R1, v.R2, v.C);
        return [["f", K.fmt(a.f, "Hz"), "big"], ["on (HIGH)", K.fmt(a.high, "s")], ["off (LOW)", K.fmt(a.low, "s")], ["duty", Math.round(a.duty * 100) + "% on"]]; } },
    { id: "div", title: "Voltage divider", unlock: "divider", why: "dividerthm", formula: "Vout = Vin × R2 ÷ (R1 + R2)",
      fields: [["vin", "Vin", "5", "V"], ["R1", "R1 (top)", "3.4k", "Ω"], ["R2", "R2 (bottom)", "6.6k", "Ω"]],
      out: (v) => { const d = K.divider(v.vin, v.R1, v.R2); return [["Vout", K.fmt(d.vout, "V"), "big"], ["current", K.fmt(d.i, "A")]]; } },
  ];
  G.calcRaw = store.get("calc", {});
  function renderCalcs() {
    const box = $("calcs");
    let html = `<p class="eyebrow">Calculators</p>`;
    for (const c of CALCS) {
      if (!unlocked(c.unlock)) { html += `<div class="calc locked"><b>${esc(c.title)}</b><span>unlocks at level ${levelNo(c.unlock)}</span></div>`; continue; }
      const raw = G.calcRaw[c.id] || {};
      html += `<section class="calc" data-calc="${c.id}"><h3>${esc(c.title)}</h3><p class="formula">${esc(c.formula)}</p><div class="calc-in">` +
        c.fields.filter((f) => !f[4] || unlocked(f[4])).map(([k, label, def, unit]) =>
          `<label for="calc-${c.id}-${k}">${esc(label)}</label><span class="unitbox"><input id="calc-${c.id}-${k}" data-k="${k}" inputmode="decimal" autocomplete="off" value="${esc(raw[k] ?? def)}"><i>${esc(unit)}</i></span>`).join("") +
        `</div><div class="calc-out" id="calc-${c.id}-out"></div>` +
        `<button class="why" data-rule="${c.why}">Why? The proof →</button></section>`;
    }
    box.innerHTML = html;
    for (const sec of box.querySelectorAll("section.calc")) {
      const c = CALCS.find((x) => x.id === sec.dataset.calc);
      const run = () => {
        const raw = {}, v = {};
        for (const f of c.fields) { const inp = $(`calc-${c.id}-${f[0]}`); raw[f[0]] = inp ? inp.value : f[2]; v[f[0]] = raw[f[0]].trim() === "" ? NaN : K.parse(raw[f[0]]); }
        G.calcRaw[c.id] = raw; store.set("calc", G.calcRaw);
        const bad = c.fields.filter((f) => $(`calc-${c.id}-${f[0]}`) && raw[f[0]].trim() !== "" && isNaN(v[f[0]]));
        const rows = bad.length ? [[`Can't read "${raw[bad[0][0]]}". Try 330, 4k7, 10u or 9m.`, "", "bad"]] : c.out(v, raw);
        $(`calc-${c.id}-out`).innerHTML = rows.map(([k, val, cls]) => `<div class="${cls || ""}"><span>${esc(k)}</span><b>${esc(val)}</b></div>`).join("");
      };
      sec.querySelectorAll("input").forEach((i) => { i.oninput = run; });
      sec.querySelector(".why").onclick = () => openRulebook(c.why);
      run();
    }
  }

  // the Rulebook: a dependency graph of every rule, and the selected rule's two-column proof
  const depth = {};
  const depthOf = (id) => depth[id] ?? (depth[id] = RB.BY_ID[id].uses.length ? 1 + Math.max(...RB.BY_ID[id].uses.map(depthOf)) : 0);
  const KIND = { definition: "Definition", law: "Law", theorem: "Theorem" };
  function ruleChips(text) {
    return String(text).replace(/@(\w+)/g, (m, id) => {
      const r = RB.BY_ID[id];
      if (!r) return m;
      return unlocked(r.unlock) ? `<button class="rchip k-${r.kind}" data-rule="${id}">${esc(r.title)}</button>` : `<span class="rchip locked">locked (level ${levelNo(r.unlock)})</span>`;
    });
  }
  function renderGraph(sel) {
    // a proof tree: definitions on top, each rule one row below the deepest rule it's built on
    const rows = {}; RB.RULES.forEach((r) => { (rows[depthOf(r.id)] = rows[depthOf(r.id)] || []).push(r); });
    const NW = 124, NH = 34, GX = 14, GY = 22, nRows = Object.keys(rows).length;
    const perRow = Math.max(...Object.values(rows).map((r) => r.length));
    const w = perRow * (NW + GX) + GX, h = 26 + nRows * (NH + GY), pos = {};
    Object.entries(rows).forEach(([d, rs]) => {
      const x0 = (w - (rs.length * (NW + GX) - GX)) / 2;                 // centre each row
      rs.forEach((r, i) => { pos[r.id] = [x0 + i * (NW + GX), 22 + d * (NH + GY)]; });
    });
    const selR = RB.BY_ID[sel], inSel = new Set(selR ? selR.uses : []);
    let edges = "", nodes = "";
    for (const r of RB.RULES) for (const u of r.uses) {
      const [x1, y1] = pos[u], [x2, y2] = pos[r.id], hot = r.id === sel || u === sel;
      const ax = x1 + NW / 2, ay = y1 + NH, bx = x2 + NW / 2, by = y2;
      edges += `<path d="M${ax},${ay} C${ax},${ay + 18} ${bx},${by - 18} ${bx},${by}" fill="none" stroke="${hot ? "#ffb000" : "#3a4f53"}" stroke-width="${hot ? 2 : 1}"/>`;
    }
    for (const r of RB.RULES) {
      const [x, y] = pos[r.id], open = unlocked(r.unlock), isSel = r.id === sel;
      const fill = !open ? "#1d2629" : { definition: "#23455c", law: "#274f37", theorem: "#5a4410" }[r.kind];
      const stroke = isSel ? "#ffb000" : inSel.has(r.id) ? "#e4ece8" : "#3a4f53";
      nodes += `<g class="gnode${open ? "" : " locked"}" data-rule="${r.id}" tabindex="${open ? 0 : -1}" role="button" aria-label="${esc(open ? r.title : "locked rule")}">` +
        `<rect x="${x}" y="${y}" width="${NW}" height="${NH}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${isSel ? 2.5 : 1.2}"/>` +
        `<text x="${x + NW / 2}" y="${y + 13}" text-anchor="middle" font-size="8" fill="#8ea39f" font-family="JetBrains Mono, monospace">${open ? KIND[r.kind].toUpperCase() : "LOCKED"}</text>` +
        `<text x="${x + NW / 2}" y="${y + 27}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${open ? "#e4ece8" : "#56666a"}">${esc(open ? r.g : "level " + levelNo(r.unlock))}</text></g>`;
    }
    $("rb-graph").innerHTML = `<svg viewBox="0 0 ${w} ${h}"><text x="${GX}" y="13" font-size="9" fill="#8ea39f" font-family="JetBrains Mono, monospace">DEFINITIONS AT THE TOP · each line: "is used to prove" the rule below it</text>${edges}${nodes}</svg>`;
    $("rb-graph").querySelectorAll(".gnode:not(.locked)").forEach((g) => { g.onclick = g.onkeydown = (ev) => { if (ev.type === "keydown" && ev.key !== "Enter") return; openRulebook(g.dataset.rule); }; });
  }
  function renderRule(id) {
    const r = RB.BY_ID[id], box = $("rb-rule");
    if (!r || !unlocked(r.unlock)) { box.innerHTML = `<p class="lesson">That rule unlocks later.</p>`; return; }
    const usedBy = RB.RULES.filter((x) => x.uses.includes(id) && unlocked(x.unlock));
    box.innerHTML = `<p class="rb-kind k-${r.kind}">${KIND[r.kind]}</p><h3>${esc(r.title)}</h3><p class="rb-short">${esc(r.short)}</p><p>${r.plain}</p>` +
      (r.given ? `<p class="rb-given"><b>Given:</b> ${ruleChips(r.given)}</p>` : "") +
      (r.proof ? `<table class="proof"><thead><tr><th>#</th><th>Statement</th><th>Reason</th></tr></thead><tbody>` +
        r.proof.map(([st, why], i) => `<tr><td>${i + 1}</td><td>${st}</td><td>${ruleChips(why)}</td></tr>`).join("") + `</tbody></table>` : "") +
      (r.figure === "compounding" ? figureCompounding() : "") +
      (r.example ? `<p class="rb-example"><b>On the bench:</b> ${r.example}</p>` : "") +
      (r.uses.length ? `<p class="rb-uses"><b>Built on:</b> ${r.uses.map((u) => ruleChips("@" + u)).join(" ")}</p>` : `<p class="rb-uses"><b>Built on:</b> nothing: this is where it starts.</p>`) +
      (usedBy.length ? `<p class="rb-uses"><b>Used to prove:</b> ${usedBy.map((u) => ruleChips("@" + u.id)).join(" ")}</p>` : "");
    box.querySelectorAll(".rchip[data-rule]").forEach((b) => { b.onclick = () => openRulebook(b.dataset.rule); });
    if (r.figure === "compounding") wireCompounding();
    box.scrollTop = 0;
  }
  // the compounding figure: n slices of RC, each keeping (1 − 1/n); n = 1 is "at the starting rate"
  function figureCompounding() {
    return `<figure class="rb-fig"><div id="comp-svg"></div><label for="comp-n">Slices of R × C: <b id="comp-nv">4</b></label>` +
      `<input type="range" id="comp-n" min="1" max="50" value="4"><figcaption id="comp-cap"></figcaption></figure>`;
  }
  function wireCompounding() {
    const draw = () => {
      const n = +$("comp-n").value, W = 460, Hh = 200, X = (t) => 40 + t * 130, Y = (v) => 14 + (1 - v) * 160;
      let curve = ""; for (let i = 0; i <= 90; i++) { const t = i / 30; curve += `${i ? "L" : "M"}${X(t).toFixed(1)},${Y(Math.exp(-t)).toFixed(1)} `; }
      let stairs = `M${X(0)},${Y(1)} `; let v = 1;
      for (let k = 0; k < n; k++) { const t1 = (k + 1) / n; stairs += `L${X(t1).toFixed(1)},${Y(v).toFixed(1)} `; v *= 1 - 1 / n; stairs += `L${X(t1).toFixed(1)},${Y(v).toFixed(1)} `; }
      $("comp-svg").innerHTML = `<svg viewBox="0 0 ${W} ${Hh}"><path d="M40,14 V174 H440" fill="none" stroke="#56666a"/>` +
        [1, 2, 3].map((t) => `<line x1="${X(t)}" y1="174" x2="${X(t)}" y2="178" stroke="#56666a"/><text x="${X(t)}" y="190" font-size="10" text-anchor="middle" fill="#8ea39f">${t} RC</text>`).join("") +
        `<text x="34" y="18" font-size="10" text-anchor="end" fill="#8ea39f">V₀</text><text x="34" y="178" font-size="10" text-anchor="end" fill="#8ea39f">0</text>` +
        `<line x1="${X(0)}" y1="${Y(1)}" x2="${X(1)}" y2="${Y(0)}" stroke="#ffb000" stroke-dasharray="5 4" stroke-width="1.5"/>` +
        `<text x="${X(1) + 4}" y="${Y(0) - 6}" font-size="10" fill="#ffb000">at the starting rate: empty at 1 RC</text>` +
        `<path d="${curve}" fill="none" stroke="#e4ece8" stroke-width="2"/>` +
        `<path d="${stairs}" fill="none" stroke="#3ddc84" stroke-width="2"/>` +
        `<line x1="${X(0)}" y1="${Y(Math.exp(-1))}" x2="${X(1)}" y2="${Y(Math.exp(-1))}" stroke="#56666a" stroke-dasharray="2 3"/>` +
        `<text x="${X(0) + 4}" y="${Y(Math.exp(-1)) - 4}" font-size="10" fill="#8ea39f">37%</text></svg>`;
      $("comp-nv").textContent = n;
      const left = Math.pow(1 - 1 / n, n);
      $("comp-cap").innerHTML = `Green: R × C cut into ${n} slice${n > 1 ? "s" : ""}, each keeping (1 − 1/${n}) of what's left. After one R × C: (1 − 1/${n})<sup>${n}</sup> = <b>${left.toFixed(3)}</b>. ` +
        (n === 1 ? "One slice is the starting-rate guess: empty at exactly R × C." : `As the slices get thinner it closes in on 1/e = <b>0.368</b> (white): the real curve.`);
    };
    $("comp-n").oninput = draw; draw();
  }
  function openRulebook(id) {
    const first = RB.RULES.find((r) => unlocked(r.unlock));
    const sel = id && RB.BY_ID[id] && unlocked(RB.BY_ID[id].unlock) ? id : G.rbSel && unlocked(RB.BY_ID[G.rbSel].unlock) ? G.rbSel : first && first.id;
    G.rbSel = sel;
    renderGraph(sel); renderRule(sel);
    $("rulebook").hidden = false;
  }
  function visit(levelId) {
    if (!G.visited.has(levelId)) { G.visited.add(levelId); store.set("visited", [...G.visited]); }
    const n = RB.RULES.filter((r) => unlocked(r.unlock)).length;
    $("rulebook-count").textContent = `${n}/${RB.RULES.length}`;
  }

  // for the tests: the same entry points a click uses
  window.StripRail = { G, clickPoint, setTool, setPower, check, loadLevel, removePart, importText, E, get ALL() { return ALL; } };
  const hot = window.claude?.hot;
  if (hot?.ready) hot.ready(boot); else boot(hot?.data ?? {});
})();
