/* Strip & Rail: the game's data (parts, cards, levels, rules), loaded and normalised. In the page it comes from
 * the bundle build.py embeds (window.BENCH_DATA); under node, from data/ via tools/bundle.js.
 * Normalising: a bin count of null means unlimited; values may be written as strings ("10u", "4k7"). */
(function (root) {
  "use strict";
  const node = typeof module !== "undefined" && module.exports;
  const raw = node ? require("../tools/bundle.js").bundle() : root.BENCH_DATA;
  const K = node ? require("./calc.js") : root.BenchCalc;
  const val = (v) => (typeof v === "string" ? K.parse(v) : v);
  const fixPart = (p) => (p && p.value !== undefined ? { ...p, value: val(p.value) } : p);
  const fixLevel = (lv) => ({
    ...lv,
    bin: (lv.bin || []).map((b) => ({ ...fixPart(b), count: b.count === null || b.count === undefined ? Infinity : b.count })),
    preset: lv.preset && lv.preset.map(fixPart),
    cards: lv.cards && lv.cards.map(fixPart),
  });
  const PARTS = Object.fromEntries(raw.parts.map((p) => [p.id, p]));
  const api = { PARTS, CARDS: raw.cards, LEVELS: raw.levels.map(fixLevel), SANDBOX: fixLevel(raw.sandbox), RULES: raw.rules, EXAMPLES: raw.examples || [], KICAD: raw.kicad };
  if (node) module.exports = api; else root.BenchData = api;
})(typeof window !== "undefined" ? window : globalThis);
