// The data files, checked the way CI will check a contribution: every reference resolves, every part is
// something the solver and the board know how to run and draw, every level only asks for what exists.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const D = require("../src/data.js");
const E = require("../src/engine.js");
const C = require("../src/cards.js");
const DIR = path.join(__dirname, "..", "data");

const MODEL_KINDS = ["wire", "resistor", "led", "diode", "capacitor", "button", "pot", "ne555", "comparator", "tone", "logicin"];   // what the solver implements
const DRAWS = ["wire", "resistor", "led", "diode", "capacitor", "electrolytic", "button", "pot", "dip", "module"];  // what the board can draw
const FRAMES = ["basic", "passive", "semi", "switch", "ic", "tool", "technique"];
const GOALS = ["lit", "button", "dimmer", "blink", "afterglow", "latch", "oneshot", "divider", "ammeter", "listen"];
const SCHEMATICS = [...fs.readFileSync(path.join(__dirname, "..", "schematics", "draw.py"), "utf8").matchAll(/^def (\w+)\(d\):/gm)].map((m) => m[1]);

test("parts: each file is a part the game can place, solve and draw", () => {
  for (const f of fs.readdirSync(path.join(DIR, "parts"))) {
    const p = JSON.parse(fs.readFileSync(path.join(DIR, "parts", f), "utf8")), where = `data/parts/${f}`;
    assert.equal(p.id + ".json", f, `${where}: id must match the file name`);
    for (const k of ["name", "prefix", "footprint", "pins", "model", "draw"]) assert.ok(p[k] !== undefined, `${where}: missing "${k}"`);
    assert.ok(MODEL_KINDS.includes(p.model.kind), `${where}: model.kind "${p.model.kind}" isn't one the solver runs (${MODEL_KINDS.join(", ")})`);
    assert.ok(DRAWS.includes(p.draw), `${where}: draw "${p.draw}" isn't one the board draws`);
    const ids = p.pins.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, `${where}: pin ids repeat`);
    const f2 = p.footprint;
    if (f2.kind === "two-lead") { assert.equal(ids.length, 2, `${where}: two-lead parts have 2 pins`); assert.ok(f2.span[0] < f2.span[1], `${where}: span`); }
    else if (f2.kind === "dip") { assert.equal(ids.length, f2.pins, `${where}: a DIP-${f2.pins} lists ${f2.pins} pins`); assert.deepEqual(ids, ids.map((_, i) => String(i + 1)), `${where}: DIP pins are "1".."${f2.pins}"`); }
    else if (f2.kind === "row") assert.equal(ids.length, f2.pins, `${where}: a row of ${f2.pins}`);
    else assert.fail(`${where}: footprint.kind "${f2.kind}"`);
    if (p.card) assert.ok(C.BY_ID[p.card], `${where}: card "${p.card}" doesn't exist in data/cards`);
    for (const m of (p.label || "").matchAll(/\{(\w+)/g)) assert.ok(p.params && p.params[m[1]], `${where}: label uses {${m[1]}} but there's no such param`);
  }
});

test("cards: each is listed in order.json once, with a real frame, rarity, art and stats", () => {
  const ids = D.CARDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "data/cards/order.json lists a card twice");
  for (const c of D.CARDS) {
    const where = `data/cards/${c.id}.json`;
    assert.ok(FRAMES.includes(c.frame), `${where}: frame "${c.frame}"`);
    assert.ok(C.RARITY[c.rarity], `${where}: rarity "${c.rarity}"`);
    assert.ok(C.ARTS.includes(c.art), `${where}: art "${c.art}" has no generator in src/cards.js`);
    assert.ok(Array.isArray(c.rules) && c.rules.length, `${where}: rules`);
    assert.ok(!/NaN|undefined/.test(C.cardHTML(c.id, {})), `${where}: renders cleanly with default values`);
  }
});

test("levels: every part, card, preset pin and hole a level uses exists", () => {
  const all = [...D.LEVELS, D.SANDBOX], ids = all.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "level ids repeat");
  for (const lv of all) {
    const where = `data/levels/${lv.id}.json`;
    if (lv.schematic) assert.ok(SCHEMATICS.includes(lv.schematic), `${where}: schematic "${lv.schematic}" isn't drawn in schematics/draw.py`);
    if (lv.goal) assert.ok(GOALS.includes(lv.goal.kind), `${where}: goal.kind "${lv.goal.kind}"`);
    for (const c of lv.cards || []) assert.ok(C.BY_ID[c.id], `${where}: card "${c.id}"`);
    for (const b of lv.bin) {
      const part = D.PARTS[b.type];
      assert.ok(part, `${where}: bin part "${b.type}" isn't in data/parts`);
      if (b.color) assert.ok(part.params.color.options[b.color], `${where}: ${b.type} has no colour "${b.color}"`);
      if (part.params && part.params.value) assert.ok(b.value > 0, `${where}: ${b.type} needs a value`);
    }
    for (const p of lv.preset || []) {
      const part = D.PARTS[p.type];
      assert.ok(part, `${where}: preset ${p.id}: part "${p.type}"`);
      assert.deepEqual(Object.keys(p.pins).sort(), part.pins.map((x) => x.id).sort(), `${where}: preset ${p.id}'s pins`);
      for (const h of Object.values(p.pins)) assert.ok(E.isHole(h) || E.isTerminal(h), `${where}: preset ${p.id}: "${h}" isn't a hole`);
    }
  }
});

test("examples: every example circuit loads, and has its schematic drawn beside it", () => {
  const CI = require("../src/circuit.js");
  assert.ok(D.EXAMPLES.length >= 5, "the examples ship with the game");
  for (const ex of D.EXAMPLES) {
    assert.deepEqual(CI.validate(CI.parse(ex.text)), [], `examples/${ex.id}/circuit.yaml`);
    assert.ok(fs.existsSync(path.join(__dirname, "..", "examples", ex.id, "schematic.svg")), `examples/${ex.id}/schematic.svg (run examples/draw.py)`);
  }
});

test("resistor colour bands: digit, digit, multiplier (gold below 10 Ω), tolerance", () => {
  const names = { "#111": "black", "#7a4a1f": "brown", "#d22": "red", "#f07a00": "orange", "#f5d000": "yellow", "#8a3bc4": "violet", "#2458d6": "blue", "#888": "grey", "#c9a227": "gold" };
  const b = (v) => C.bands(v).map((c) => names[c] || c).join("-");
  assert.equal(b(330), "orange-orange-brown-gold");
  assert.equal(b(10000), "brown-black-orange-gold");
  assert.equal(b(68000), "blue-grey-orange-gold");
  assert.equal(b(47), "yellow-violet-black-gold");
  assert.equal(b(4.7), "yellow-violet-gold-gold", "4.7 Ω: the multiplier band is gold (×0.1)");
});
