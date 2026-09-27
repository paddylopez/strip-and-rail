/* Strip & Rail: the card set. Every part (and the board, the supply, the meter) is a card, the way a collectible
 * card packs a lot into one frame: the art is the part as it sits on the bench, the keywords are its rules (with
 * reminder text), the stats box is its ratings, the flavor text is the line you'll remember.
 * Card art is drawn here as SVG (viewBox 0 0 200 112); `v` is the variant (a resistor's value, an LED's colour). */
(function (root) {
  "use strict";
  const INK = "#e4ece8", DIM = "#8ea39f", MAT = "#1b282b";
  const BAND = ["#111", "#7a4a1f", "#d22", "#f07a00", "#f5d000", "#2a9d2a", "#2458d6", "#8a3bc4", "#888", "#f4f4f4"];
  const node = typeof module !== "undefined" && module.exports;
  const D = node ? require("./data.js") : root.BenchData;
  const K = node ? require("./calc.js") : root.BenchCalc;
  const LED = D.PARTS.led.params.color.options;           // colours and forward voltages: data/parts/led.json
  const LEDRGB = Object.fromEntries(Object.entries(LED).map(([k, o]) => [k, o.rgb.join(",")]));
  const VF = Object.fromEntries(Object.entries(LED).map(([k, o]) => [k, o.vf]));
  const fmtR = (v) => v >= 1000 ? v / 1000 + " kΩ" : v + " Ω";
  const fmtC = (v) => v >= 1e-6 ? +(v * 1e6).toPrecision(3) + " µF" : +(v * 1e9).toPrecision(3) + " nF";
  const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-family="JetBrains Mono, monospace" font-size="${o.size || 8.5}" fill="${o.fill || INK}" text-anchor="${o.anchor || "middle"}"${o.weight ? ` font-weight="${o.weight}"` : ""}>${s}</text>`;
  const frame = (inner) => `<svg viewBox="0 0 200 112" xmlns="http://www.w3.org/2000/svg" role="img"><rect width="200" height="112" fill="${MAT}"/>` +
    `<g opacity=".25">${Array.from({ length: 14 }, (_, i) => `<circle cx="${7 + i * 14}" cy="7" r=".8" fill="#4a6166"/>`).join("")}</g>${inner}</svg>`;
  const bands = (v) => { const e = Math.floor(Math.log10(v)) - 1, d = Math.round(v / Math.pow(10, e)); return [BAND[Math.floor(d / 10)], BAND[d % 10], (e >= 0 ? BAND[e] : e === -1 ? "#c9a227" : "#b8b8b8"), "#c9a227"]; };

  const ART = {
    breadboard: () => {
      let h = `<rect x="14" y="12" width="172" height="92" rx="4" fill="#efece3"/>`;
      h += `<line x1="22" y1="17" x2="178" y2="17" stroke="#2b6cc4" stroke-width="1"/><line x1="22" y1="33" x2="178" y2="33" stroke="#d7263d" stroke-width="1"/>`;
      h += `<rect x="22" y="25" width="156" height="7" rx="3" fill="#d7263d" opacity=".25"/>`;
      for (let c = 0; c < 13; c++) { const x = 28 + c * 12; if (c % 6 !== 5) { h += `<rect x="${x - 1.5}" y="19.5" width="3" height="3" fill="#3b3a36"/><rect x="${x - 1.5}" y="27" width="3" height="3" fill="#3b3a36"/>`; } }
      h += `<rect x="61" y="37.5" width="10" height="29" rx="3" fill="#ffb000" opacity=".45"/><rect x="109" y="73.5" width="10" height="29" rx="3" fill="#ffb000" opacity=".45"/>`;
      h += `<rect x="14" y="68" width="172" height="5" fill="#dcd8cb"/>`;
      for (let c = 0; c < 13; c++) for (let r = 0; r < 5; r++) {
        const x = 28 + c * 12; h += `<rect x="${x - 1.5}" y="${40 + r * 5.5}" width="3" height="3" fill="#3b3a36"/><rect x="${x - 1.5}" y="${76 + r * 5.5}" width="3" height="3" fill="#3b3a36"/>`;
      }
      return frame(h + t(66, 110, "a–e: one strip", { size: 7, fill: DIM }) + t(144, 110, "f–j: another", { size: 7, fill: DIM }) + t(186, 29.5, "rail", { size: 7, fill: DIM, anchor: "end" }));
    },
    wire: () => frame(`<path d="M34,86 C60,10 140,10 166,86" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="9" stroke-linecap="round"/>` +
      `<path d="M34,86 C60,10 140,10 166,86" fill="none" stroke="#f0c419" stroke-width="7" stroke-linecap="round"/>` +
      `<rect x="31" y="86" width="6" height="14" fill="#c9c9c9"/><rect x="163" y="86" width="6" height="14" fill="#c9c9c9"/>` +
      t(100, 56, "red: +   black: −", { fill: DIM, size: 8 }) + t(100, 68, "others: signals", { fill: DIM, size: 8 })),
    supply: () => frame(`<rect x="22" y="14" width="156" height="84" rx="6" fill="#2a2f33"/><rect x="32" y="24" width="96" height="48" rx="3" fill="#120c00"/>` +
      t(122, 45, "5.00 V", { size: 15, fill: "#ffb000", anchor: "end" }) + t(122, 64, "0.009 A", { size: 11, fill: "#ffb000", anchor: "end" }) + t(38, 64, "CV", { size: 8, fill: "#3ddc84", anchor: "start" }) +
      `<circle cx="146" cy="78" r="9" fill="#c8202b"/><circle cx="146" cy="78" r="3.5" fill="#d9d4c7"/><circle cx="168" cy="78" r="9" fill="#1a1a1a" stroke="#000"/><circle cx="168" cy="78" r="3.5" fill="#d9d4c7"/>` +
      t(146, 63, "+", { size: 11, fill: "#ff6a6a", weight: 700 }) + t(168, 63, "−", { size: 11, weight: 700 }) + t(60, 90, "CV until the limit, then CC", { size: 7, fill: DIM })),
    resistor: (v = {}) => frame(`<line x1="16" y1="54" x2="184" y2="54" stroke="#b5b5b5" stroke-width="2.5"/>` +
      `<rect x="66" y="40" width="68" height="28" rx="13" fill="#e3c59b" stroke="#9c7a4a"/>` +
      bands(v.value || 330).map((c, i) => `<rect x="${78 + i * 10 + (i === 3 ? 8 : 0)}" y="40" width="5.5" height="28" fill="${c}"/>`).join("") +
      t(100, 90, `${fmtR(v.value || 330)} · either way round`, { fill: DIM })),
    led: (v = {}) => {
      const c = LEDRGB[v.color || "red"];
      return frame(`<circle cx="100" cy="38" r="30" fill="rgb(${c})" opacity=".18"/>` +
        `<path d="M84,70 V38 A16,16 0 0,1 116,38 V70 Z" fill="rgba(${c},.75)" stroke="rgba(0,0,0,.4)"/>` +
        `<path d="M80,70 H118 V76 H80 Z" fill="rgba(${c},.85)" stroke="rgba(0,0,0,.4)"/><line x1="118" y1="70" x2="118" y2="76" stroke="#111" stroke-width="2"/>` +
        `<line x1="93" y1="76" x2="93" y2="108" stroke="#c9c9c9" stroke-width="2.5"/><line x1="107" y1="76" x2="107" y2="98" stroke="#c9c9c9" stroke-width="2.5"/>` +
        t(62, 96, "A  +", { anchor: "end", weight: 700, fill: "#ff8a80" }) + t(62, 106, "long leg", { anchor: "end", fill: DIM, size: 7 }) +
        t(126, 90, "K  −", { anchor: "start", weight: 700 }) + t(126, 100, "short leg,", { anchor: "start", fill: DIM, size: 7 }) + t(126, 108, "flat side", { anchor: "start", fill: DIM, size: 7 }));
    },
    button: () => frame(`<rect x="72" y="16" width="56" height="56" rx="4" fill="#232323" stroke="#000"/><circle cx="100" cy="44" r="15" fill="#b8b8b8" stroke="#000"/>` +
      `<line x1="84" y1="72" x2="84" y2="96" stroke="#c9c9c9" stroke-width="2.5"/><line x1="116" y1="72" x2="116" y2="96" stroke="#c9c9c9" stroke-width="2.5"/>` +
      t(84, 106, "1") + t(116, 106, "2") + t(160, 44, "press", { fill: DIM }) + t(160, 54, "and hold", { fill: DIM })),
    pot: (v = {}) => frame(`<rect x="62" y="12" width="76" height="62" rx="5" fill="#1f5fae" stroke="#0d3160"/>` +
      `<path d="M78,60 A26,26 0 1,1 122,60" fill="none" stroke="#0d3160" stroke-width="5"/>` +
      `<g transform="translate(100,42) rotate(20)"><circle r="18" fill="#f2f2f2" stroke="#999"/><rect x="-2" y="-16" width="4" height="13" fill="#333"/></g>` +
      [76, 100, 124].map((x) => `<line x1="${x}" y1="74" x2="${x}" y2="96" stroke="#c9c9c9" stroke-width="2.5"/>`).join("") +
      t(76, 106, "1") + t(100, 106, "W", { weight: 700, fill: "#ffb000" }) + t(124, 106, "3") + t(168, 40, fmtR(v.value || 10000), { fill: DIM }) + t(168, 52, "end to end", { fill: DIM, size: 7 })),
    electrolytic: (v = {}) => frame(`<rect x="80" y="12" width="40" height="70" rx="8" fill="#1d3f8f" stroke="#0b1f4f"/>` +
      `<rect x="106" y="12" width="14" height="70" rx="0" fill="#c7d3ee" opacity=".9"/>` +
      [30, 46, 62].map((y) => t(113, y, "−", { size: 10, fill: "#1d3f8f", weight: 700 })).join("") +
      `<line x1="92" y1="82" x2="92" y2="108" stroke="#c9c9c9" stroke-width="2.5"/><line x1="108" y1="82" x2="108" y2="98" stroke="#c9c9c9" stroke-width="2.5"/>` +
      t(66, 98, "+ long", { anchor: "end", weight: 700, fill: "#ff8a80" }) + t(124, 106, "− stripe", { anchor: "start", weight: 700 }) + t(164, 40, fmtC(v.value || 10e-6), { fill: DIM })),
    ceramic: () => frame(`<ellipse cx="100" cy="44" rx="28" ry="24" fill="#d99a2b" stroke="#8a6212"/>` + t(100, 48, "104", { size: 11, fill: "#3a2600", weight: 700 }) +
      `<line x1="90" y1="66" x2="90" y2="104" stroke="#c9c9c9" stroke-width="2.5"/><line x1="110" y1="66" x2="110" y2="104" stroke="#c9c9c9" stroke-width="2.5"/>` +
      t(160, 44, "10 + 0000 pF", { fill: DIM, size: 7.5 }) + t(160, 55, "= 100 nF", { fill: DIM, size: 7.5 })),
    diode: () => frame(`<line x1="16" y1="54" x2="184" y2="54" stroke="#b5b5b5" stroke-width="2.5"/>` +
      `<rect x="76" y="44" width="48" height="20" rx="6" fill="#e9a07a" fill-opacity=".85" stroke="#a0522d"/><rect x="110" y="44" width="7" height="20" fill="#1a1a1a"/>` +
      t(40, 44, "A") + t(160, 44, "K  band") + t(100, 90, "current: A → K only", { fill: DIM })),
    ne555: () => {
      let h = `<rect x="48" y="34" width="104" height="44" rx="3" fill="#262626"/><path d="M48,51 a5,5 0 0,1 0,10" fill="#555"/><circle cx="60" cy="71" r="2.2" fill="#777"/>` + t(104, 60, "NE555", { size: 11, fill: "#ddd" });
      const bot = ["GND", "TRIG", "OUT", "RST"], top = ["VCC", "DIS", "THR", "CTRL"];
      [64, 88, 112, 136].forEach((x, i) => {
        h += `<rect x="${x - 3}" y="78" width="6" height="11" fill="#c9c9c9"/><rect x="${x - 3}" y="23" width="6" height="11" fill="#c9c9c9"/>`;
        h += t(x, 98, String(i + 1), { weight: 700 }) + t(x, 107, bot[i], { size: 6.5, fill: DIM });
        h += t(x, 18, String(8 - i), { weight: 700 }) + t(x, 10, top[i], { size: 6.5, fill: DIM });
      });
      return frame(h + t(30, 60, "notch", { size: 7, fill: DIM }));
    },
    meter: (v = {}) => {
      const amps = v.amps;
      return frame(`<rect x="62" y="6" width="76" height="100" rx="10" fill="#e0a526"/><rect x="70" y="14" width="60" height="84" rx="5" fill="#1c1c1c"/>` +
        `<rect x="76" y="20" width="48" height="20" rx="2" fill="#a9c7b2"/>` + t(121, 35, amps ? "9.09mA" : "1.99 V", { size: 10.5, fill: "#1a2a20", anchor: "end", weight: 700 }) +
        `<circle cx="100" cy="64" r="15" fill="#333" stroke="#555"/><line x1="100" y1="64" x2="${amps ? 112 : 88}" y2="${amps ? 56 : 56}" stroke="#eee" stroke-width="3" stroke-linecap="round"/>` +
        t(84, 50, "V", { size: 7, fill: amps ? DIM : "#ffb000", weight: 700 }) + t(116, 50, "A", { size: 7, fill: amps ? "#ffb000" : DIM, weight: 700 }) + t(100, 90, "Ω  ))) ", { size: 7, fill: DIM }) +
        `<path d="M70,94 C40,98 30,70 18,60" fill="none" stroke="#c8202b" stroke-width="3"/><path d="M130,94 C160,98 170,70 182,60" fill="none" stroke="#1a1a1a" stroke-width="3"/>` +
        `<line x1="18" y1="60" x2="10" y2="48" stroke="#ddd" stroke-width="2"/><line x1="182" y1="60" x2="190" y2="48" stroke="#ddd" stroke-width="2"/>` +
        (amps ? `<circle cx="${130}" cy="94" r="5" fill="none" stroke="#ffb000" stroke-width="1.5"/>` + t(160, 108, "the A socket", { size: 7, fill: "#ffb000" }) : ""));
    },
    // any DIP chip, from its part data: pin numbers and each pin's short name
    dip: (v = {}) => {
      const P = D.PARTS[v.part], n = P.footprint.pins, half = n / 2, xs = Array.from({ length: half }, (_, i) => 64 + i * (96 / Math.max(1, half - 1)));
      let h = `<rect x="48" y="34" width="104" height="44" rx="3" fill="#262626"/><path d="M48,51 a5,5 0 0,1 0,10" fill="#555"/><circle cx="60" cy="71" r="2.2" fill="#777"/>` + t(104, 60, P.chip || P.name, { size: 11, fill: "#ddd" });
      xs.forEach((x, i) => {
        const bot = P.pins[i], top = P.pins[n - 1 - i];
        h += `<rect x="${x - 3}" y="78" width="6" height="11" fill="#c9c9c9"/><rect x="${x - 3}" y="23" width="6" height="11" fill="#c9c9c9"/>`;
        h += t(x, 98, bot.id, { weight: 700 }) + t(x, 107, bot.short || "", { size: 6.5, fill: DIM });
        h += t(x, 18, top.id, { weight: 700 }) + t(x, 10, top.short || "", { size: 6.5, fill: DIM });
      });
      return frame(h + t(30, 60, "notch", { size: 7, fill: DIM }));
    },
    tone: () => {
      let d = "M70,78"; for (let i = 0; i <= 60; i++) d += ` L${70 + i * 1.8},${78 - 12 * Math.sin(i / 60 * 6 * Math.PI)}`;
      return frame(`<rect x="46" y="12" width="108" height="80" rx="5" fill="#1f4fa3"/><circle cx="100" cy="38" r="17" fill="#2b2b2b" stroke="#999" stroke-width="2"/>` +
        `<circle cx="100" cy="38" r="9" fill="#444"/><path d="${d}" fill="none" stroke="#ffb000" stroke-width="2"/>` +
        ["VDD", "GND", "OUT"].map((l, i) => `<rect x="${72 + i * 28 - 3}" y="92" width="6" height="12" fill="#c9c9c9"/>` + t(72 + i * 28, 111, l, { size: 7 })).join(""));
    },
    esp32: () => frame(`<rect x="44" y="14" width="112" height="76" rx="5" fill="#1c1c1c" stroke="#000"/><rect x="62" y="24" width="62" height="44" rx="2" fill="#9a9a9a"/>` +
      t(93, 50, "ESP32", { size: 11, fill: "#1c1c1c", weight: 700 }) + `<circle cx="140" cy="36" r="6" fill="#3ddc84"/>` + t(140, 56, "awake", { size: 7, fill: "#3ddc84" }) +
      ["G33", "GND"].map((l, i) => `<rect x="${86 + i * 28 - 3}" y="90" width="6" height="12" fill="#c9c9c9"/>` + t(86 + i * 28, 110, l, { size: 7 })).join("")),
    envelope: () => {
      let wave = "M16,56", env = "M16,56";
      for (let i = 0; i <= 168; i++) { const x = 16 + i, a = i < 40 ? 4 : i < 120 ? 34 : 6; wave += ` L${x},${56 - a * Math.sin(i / 3)}`; }
      env += " C40,56 44,26 60,24 L130,23 C150,23 160,44 184,50";
      return frame(`<path d="${wave}" fill="none" stroke="${DIM}" stroke-width="1"/><path d="${env}" fill="none" stroke="#ffb000" stroke-width="2.5"/>` +
        `<line x1="16" y1="36" x2="186" y2="36" stroke="#e4ece8" stroke-dasharray="3 3"/>` + t(186, 32, "threshold", { size: 7, anchor: "end" }) +
        t(100, 102, "the sound (grey) and its envelope (amber)", { size: 7.5, fill: DIM }));
    },
    // technique art: the idea as a diagram, in chalk on the mat
    series: () => frame([["R", 44], ["LED", 100], ["LED", 156]].map(([l, x]) => `<rect x="${x - 20}" y="34" width="40" height="22" rx="4" fill="none" stroke="${INK}" stroke-width="1.5"/>` + t(x, 49, l)).join("") +
      `<path d="M14,45 H24 M64,45 H80 M120,45 H136 M176,45 H188" fill="none" stroke="${INK}" stroke-width="1.5"/>` +
      t(100, 24, "→ the same current through every part →", { fill: "#ffb000", size: 7.5 }) + t(44, 74, "0.8 V", { fill: DIM }) + t(100, 74, "2.1 V", { fill: DIM }) + t(156, 74, "2.1 V", { fill: DIM }) +
      t(100, 96, "0.8 + 2.1 + 2.1 = 5 V", { weight: 700 })),
    rc: () => {
      let d = "M22,20"; for (let i = 1; i <= 60; i++) { const x = 22 + i * 2.7, y = 20 + 70 * (1 - Math.exp(-i / 12)); d += ` L${x.toFixed(1)},${y.toFixed(1)}`; }
      return frame(`<path d="M22,14 V92 H186" fill="none" stroke="${DIM}" stroke-width="1"/><path d="${d}" fill="none" stroke="#ffb000" stroke-width="2.2"/>` +
        `<line x1="54.4" y1="14" x2="54.4" y2="92" stroke="${INK}" stroke-dasharray="3 3"/>` + t(54, 104, "1 × RC", { size: 7.5 }) +
        `<line x1="184" y1="14" x2="184" y2="92" stroke="${DIM}" stroke-dasharray="2 4"/>` + t(176, 104, "5 × RC", { size: 7.5, fill: DIM }) +
        t(122, 38, "drains: ⅔ gone in 1 RC,", { fill: DIM, size: 7.5 }) + t(122, 50, "nearly all in 5", { fill: DIM, size: 7.5 }));
    },
    pullup: () => frame(`<path d="M100,10 V22" fill="none" stroke="${INK}" stroke-width="1.5"/>` + t(100, 9, "+5 V", { size: 7.5 }) +
      `<path d="M100,22 l6,4 l-12,5 l12,5 l-12,5 l12,5 l-6,3" fill="none" stroke="${INK}" stroke-width="1.5"/>` + t(128, 38, "10 kΩ", { size: 7.5, anchor: "start" }) +
      `<path d="M100,49 V60 H136" fill="none" stroke="${INK}" stroke-width="1.5"/><circle cx="100" cy="60" r="2.5" fill="${INK}"/>` + t(140, 63, "pin: HIGH", { anchor: "start", fill: "#ffb000", weight: 700, size: 8 }) +
      `<path d="M100,60 V74" fill="none" stroke="${INK}" stroke-width="1.5"/><circle cx="100" cy="76" r="2" fill="none" stroke="${INK}"/><circle cx="100" cy="90" r="2" fill="none" stroke="${INK}"/>` +
      `<path d="M92,74 L94,92" fill="none" stroke="${INK}" stroke-width="1.5"/><path d="M100,92 V100 M92,100 H108 M95,103 H105" fill="none" stroke="${INK}" stroke-width="1.5"/>` +
      t(64, 86, "press:", { anchor: "end", fill: DIM, size: 7.5 }) + t(64, 96, "LOW", { anchor: "end", fill: DIM, size: 7.5 })),
    oneshot: () => frame(`<path d="M16,44 H40 V30 H44 V44 H186" fill="none" stroke="${DIM}" stroke-width="1.5"/>` + t(16, 26, "press", { anchor: "start", fill: DIM, size: 7.5 }) +
      `<path d="M16,92 H40 V66 H134 V92 H186" fill="none" stroke="#ffb000" stroke-width="2.2"/>` + t(87, 60, "output on: 1.1 × R × C", { size: 7.5, fill: "#ffb000" }) +
      `<line x1="40" y1="100" x2="134" y2="100" stroke="${INK}" stroke-width="1"/>` + t(87, 110, "≈ 1.1 s", { size: 7.5 })),
    astable: () => {
      let saw = "M16,70", sq = "M16,40";
      for (let k = 0; k < 4; k++) { const x = 16 + k * 42; saw += ` Q${x + 16},${50} ${x + 28},${54} L${x + 42},${70}`; sq += ` V26 H${x + 28} V40 H${x + 42}`; }
      return frame(`<line x1="16" y1="54" x2="186" y2="54" stroke="${DIM}" stroke-dasharray="3 3"/><line x1="16" y1="70" x2="186" y2="70" stroke="${DIM}" stroke-dasharray="3 3"/>` +
        t(190, 57, "⅔", { anchor: "end", size: 7, fill: DIM }) + t(190, 80, "⅓", { anchor: "end", size: 7, fill: DIM }) +
        `<path d="${sq}" fill="none" stroke="#ffb000" stroke-width="2"/>` + t(100, 18, "pin 3: the LED", { size: 7.5, fill: "#ffb000" }) +
        `<path d="${saw}" fill="none" stroke="${INK}" stroke-width="1.6"/>` + t(100, 100, "C1 bounces between ⅓ and ⅔ of the supply", { size: 7.5 }));
    },
    divider: () => frame(`<path d="M60,10 V20 l6,4 l-12,5 l12,5 l-12,5 l6,3 V56 l6,4 l-12,5 l12,5 l-12,5 l6,3 V100" fill="none" stroke="${INK}" stroke-width="1.5"/>` +
      t(60, 8, "Vin", { size: 7.5 }) + t(76, 38, "R1", { anchor: "start", size: 7.5 }) + t(76, 74, "R2", { anchor: "start", size: 7.5 }) +
      `<circle cx="60" cy="56" r="2.5" fill="#ffb000"/><path d="M60,56 H104" fill="none" stroke="#ffb000" stroke-width="1.5"/>` + t(108, 59, "Vout", { anchor: "start", fill: "#ffb000", weight: 700 }) +
      t(130, 86, "Vin × R2 ÷ (R1 + R2)", { size: 7.5, fill: DIM }) + `<path d="M52,100 H68 M55,103 H65" fill="none" stroke="${INK}" stroke-width="1.5"/>`),
  };

  // the cards themselves live in data/cards/<id>.json (numbered by data/cards/order.json)
  // frame: basic | passive | semi | switch | ic | tool | technique.   rarity: B basic, C common, U uncommon, R rare
  const CARDS = D.CARDS.map((c, i) => ({ ...c, no: i + 1 }));
  const BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  const FOR_PART = Object.fromEntries(Object.values(D.PARTS).filter((p) => p.card).map((p) => [p.id, p.card]));
  /** Stats templates: "{value:Ω|330} · ¼ W" -> the variant's value (or the default), formatted with its unit. */
  function stats(tpl, v) {
    const vars = { ...v, vf: v.color ? VF[v.color] : v.vf };
    return tpl.replace(/\{(\w+):([^|}]*)\|?([^}]*)\}/g, (m, key, unit, def) => {
      const x = vars[key] !== undefined ? vars[key] : def === "" ? NaN : K.parse(def);
      return K.fmt(x, unit);
    });
  }
  const RARITY = { B: "Basic", C: "Common", U: "Uncommon", R: "Rare" };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  /** The card as HTML. v: variant ({value} / {color}); sch: the schematic-symbol data URIs. */
  function cardHTML(id, v = {}, sch = {}) {
    const c = BY_ID[id];
    if (!c) return "";
    const art = ART[c.art]({ ...(c.artV || {}), ...v });
    const st = stats(c.stats, v);
    const sym = c.symbol && sch[c.symbol] ? `<img class="mtg-sym" alt="" src="${sch[c.symbol]}">` : "";
    const rules = c.rules.map(([k, r]) => r ? `<p><b>${esc(k)}</b> <i>(${esc(r)})</i></p>` : `<p>${esc(k)}</p>`).join("");
    return `<article class="mtg f-${c.frame}" aria-label="${esc(c.name)} card">` +
      `<header class="mtg-name"><span>${esc(c.name)}</span><span class="mtg-cost">${esc(c.cost)}</span></header>` +
      `<div class="mtg-art">${art}</div>` +
      `<div class="mtg-type"><span>${esc(c.type)}</span>${sym}<span class="mtg-rar r-${c.rarity}" title="${RARITY[c.rarity]}">◆</span></div>` +
      `<div class="mtg-text">${rules}<p class="mtg-flavor">${esc(c.flavor)}</p></div>` +
      `<footer class="mtg-foot"><span>SR · ${String(c.no).padStart(3, "0")}/${String(CARDS.length).padStart(3, "0")} · ${c.rarity}</span><span class="mtg-stats">${esc(st)}</span></footer></article>`;
  }
  function cardBack(label) {
    return `<article class="mtg mtg-back" aria-label="Locked card"><div class="mtg-back-in"><span>STRIP<br>&amp;<br>RAIL</span><small>${esc(label)}</small></div></article>`;
  }

  const api = { CARDS, BY_ID, FOR_PART, RARITY, ARTS: Object.keys(ART), cardHTML, cardBack, bands };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BenchCards = api;
})(typeof window !== "undefined" ? window : globalThis);
