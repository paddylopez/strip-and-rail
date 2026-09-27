/* Strip & Rail: circuit files -> levels. A circuit file is a parts list and a netlist (which pins join),
 * plus how to win: `wiring: nets` (your breadboard joins exactly those pins) and/or behaviour goals.
 * Format: docs/CIRCUITS.md; worked examples: examples/. YAML or JSON; values may be "330", "4k7", "10u".
 *
 *   parse(text)              -> the document (YAML or JSON)
 *   validate(doc)            -> [] or ["nets.GND: U1.9 -- a 555 has pins 1-8", ...]
 *   toLevel(doc, extra)      -> a level the game can load (bin by designator, cards, goal, netlist) */
(function (root) {
  "use strict";
  const node = typeof module !== "undefined" && module.exports;
  const D = node ? require("./data.js") : root.BenchData;
  const K = node ? require("./calc.js") : root.BenchCalc;
  const YAML = node ? require("../vendor/js-yaml.min.js") : root.jsyaml;
  const FORMAT = "strip-and-rail/circuit@1";
  const GOALS = ["lit", "button", "dimmer", "blink", "afterglow", "latch", "oneshot", "divider", "listen"];
  const REF = /^[A-Za-z][A-Za-z0-9_]*$/;

  function parse(text) {
    const t = String(text).replace(/^﻿/, "");
    if (/^\s*[{[]/.test(t)) return JSON.parse(t);
    if (!YAML) throw new Error("YAML needs js-yaml; paste JSON instead");
    return YAML.load(t);
  }
  const num = (v) => (typeof v === "string" ? K.parse(v) : v);

  /** Every problem with the document, each naming where it is. Empty means it loads. */
  function validate(doc) {
    const E = [];
    if (!doc || typeof doc !== "object") return ["The file is empty, or isn't YAML/JSON."];
    if (doc.format !== FORMAT) E.push(`format: expected "${FORMAT}"${doc.format ? `, got "${doc.format}"` : " (add it as the first line)"}.`);
    if (!doc.title) E.push("title: every circuit needs one.");
    const s = doc.supply || {};
    if (!(num(s.v) > 0 && num(s.v) <= 30)) E.push("supply.v: a voltage between 0 and 30, like 5.");
    if (s.ilim !== undefined && !(num(s.ilim) > 0 && num(s.ilim) <= 3)) E.push("supply.ilim: a current limit up to 3 A, like 100m.");
    const parts = doc.parts || {};
    if (!Object.keys(parts).length) E.push("parts: list at least one part, like  R1: { part: resistor, value: 330 }");
    for (const [ref, spec] of Object.entries(parts)) {
      const at = `parts.${ref}`;
      if (!REF.test(ref)) { E.push(`${at}: a designator is letters then letters/digits, like R1 or LED2.`); continue; }
      if (ref === "PSU") { E.push(`${at}: PSU is the bench supply; pick another name.`); continue; }
      const P = spec && D.PARTS[spec.part];
      if (!P) { E.push(`${at}: part "${spec && spec.part}" isn't in the library (${Object.keys(D.PARTS).filter((k) => k !== "wire").join(", ")}).`); continue; }
      if (spec.part === "wire") E.push(`${at}: wires aren't parts here; the nets say what's joined, and the player chooses the wires.`);
      if (P.params && P.params.value && !(num(spec.value) > 0)) E.push(`${at}: a ${P.name.toLowerCase()} needs a value, like ${P.params.value.unit === "Ω" ? "330 or 4k7" : "10u or 100n"}.`);
      if (P.params && P.params.color && !P.params.color.options[spec.color]) E.push(`${at}: color must be one of ${Object.keys(P.params.color.options).join(", ")}.`);
    }
    const nets = doc.nets || {};
    const seen = {};
    for (const [name, pins] of Object.entries(nets)) {
      const at = `nets.${name}`;
      if (!Array.isArray(pins) || pins.length < 2) { E.push(`${at}: a net joins two or more pins, like [R1.2, LED1.A].`); continue; }
      for (const pin of pins) {
        const m = String(pin).match(/^([^.]+)\.(.+)$/);
        if (!m) { E.push(`${at}: "${pin}" should be REF.PIN, like R1.2 or U1.8.`); continue; }
        const [, ref, p] = m;
        if (ref === "PSU") { if (p !== "+" && p !== "-") E.push(`${at}: the supply's pins are PSU.+ and PSU.-`); }
        else if (!parts[ref]) { E.push(`${at}: "${pin}": there's no part ${ref} in parts.`); continue; }
        else {
          const P = D.PARTS[parts[ref].part];
          if (P && !P.pins.some((x) => x.id === p)) E.push(`${at}: "${pin}": a ${P.name.toLowerCase()}'s pins are ${P.pins.map((x) => x.id).join(", ")}.`);
        }
        if (seen[pin]) E.push(`${at}: "${pin}" is already in net ${seen[pin]}; a pin belongs to one net (merge the two nets).`);
        seen[pin] = name;
      }
    }
    for (const t of ["PSU.+", "PSU.-"]) if (!seen[t]) E.push(`nets: nothing connects to ${t}; put it in the net it powers (like VCC or GND).`);
    for (const c of doc.cards || []) if (!D.CARDS.some((x) => x.id === c)) E.push(`cards: "${c}" isn't a card (see data/cards).`);
    for (const w of doc.win || []) {
      if (w.goal && w.goal.kind === "listen" && (!["talk", "horn"].includes(w.goal.sound) || !["high", "low"].includes(w.goal.expect)))
        E.push(`win: a listen goal needs sound: talk|horn and expect: high|low.`);
      if (w.wiring !== undefined && w.wiring !== "nets") E.push(`win: "wiring" takes the value nets.`);
      if (w.goal && !GOALS.includes(w.goal.kind)) E.push(`win: goal.kind "${w.goal.kind}" isn't one of ${GOALS.join(", ")}.`);
      if (!w.goal && w.wiring === undefined) E.push(`win: each entry is  - wiring: nets  or  - goal: {...}`);
    }
    return E;
  }

  /** The level: one bin item per designator (placing it names it), its cards, its goal, its netlist. */
  function toLevel(doc, extra = {}) {
    const parts = doc.parts;
    const bin = Object.entries(parts).map(([ref, spec]) => {
      const it = { type: spec.part, count: 1, ref };
      if (spec.value !== undefined) it.value = num(spec.value);
      if (spec.color) it.color = spec.color;
      return it;
    }).concat([{ type: "wire", count: Infinity }]);
    const cards = [], seenCard = new Set();
    for (const it of bin) {
      const c = D.PARTS[it.type] && D.PARTS[it.type].card;
      if (c && !seenCard.has(c) && it.type !== "wire") { seenCard.add(c); cards.push({ id: c, value: it.value, color: it.color }); }
    }
    for (const c of doc.cards || []) if (!seenCard.has(c)) { seenCard.add(c); cards.push({ id: c }); }   // extra cards: techniques
    const nets = Object.fromEntries(Object.entries(doc.nets).map(([k, v]) => [k, v.map(String)]));
    const win = doc.win && doc.win.length ? doc.win : [{ wiring: "nets" }];
    const of = win.map((w) => {
      if (w.goal) { const g = { ...w.goal }; for (const k of ["min", "max", "fmin", "fmax", "minGlow", "maxGlow", "minPulse", "maxPulse", "ratio", "hold", "seconds"]) if (g[k] !== undefined) g[k] = num(g[k]); return g; }
      return { kind: "netlist" };
    });
    return {
      id: extra.id || "circuit-" + String(doc.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      title: doc.title, schematic: extra.schematic || null, circuit: true, group: extra.group || "yours",
      cards, supply: { v: num(doc.supply.v), ilim: num(doc.supply.ilim ?? "100m") },
      brief: doc.brief ? [].concat(doc.brief) : [
        "Build the schematic. The parts bin has each part by its designator, so R1 on the board is R1 in the schematic.",
        "Connections lists every net: the pins that must end up joined. Any layout that joins exactly those pins is right.",
      ],
      lesson: doc.lesson || doc.about || "",
      about: doc.about || "",
      bin, nets, goal: { kind: "all", of },
    };
  }

  const api = { FORMAT, parse, validate, toLevel };
  if (node) module.exports = api; else root.BenchCircuit = api;
})(typeof window !== "undefined" ? window : globalThis);
