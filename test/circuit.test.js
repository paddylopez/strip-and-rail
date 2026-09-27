// Circuit files -> levels: every example loads, a correct breadboard build of each passes (wiring AND
// behaviour), and the classic mistakes fail with the net named. Plus: bad files get useful messages.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const E = require("../src/engine.js");
const C = require("../src/circuit.js");
const EX = path.join(__dirname, "..", "examples");
const load = (d) => C.toLevel(C.parse(fs.readFileSync(path.join(EX, d, "circuit.yaml"), "utf8")), { id: "ex-" + d });

let n = 0;
const W = (a, b) => ({ id: "W" + ++n, type: "wire", pins: { a, b } });
const R = (id, value, a, b) => ({ id, type: "resistor", value, pins: { 1: a, 2: b } });
const LED = (id, A, K, color) => ({ id, type: "led", color, pins: { A, K } });
const power = () => [W("PSU.+", "T+5"), W("PSU.-", "T-6")];
const bridges = () => [W("T+3", "B+3"), W("T-4", "B-4")];
const U1 = () => ({ id: "U1", type: "ne555", pins: { 1: "f30", 2: "f31", 3: "f32", 4: "f33", 5: "e33", 6: "e32", 7: "e31", 8: "e30" } });
const blinker = () => [...power(), ...bridges(), U1(), W("j30", "B-30"), W("a30", "T+30"), W("j33", "B+33"),
  R("R1", 10000, "T+27", "a31"), R("R2", 68000, "b31", "b35"), W("c35", "c32"), W("g31", "d32"),
  { id: "C1", type: "electrolytic", value: 10e-6, pins: { "+": "j31", "-": "B-31" } },
  R("R3", 330, "g32", "g36"), LED("LED1", "h36", "h38", "red"), W("j38", "B-39")];
const good = {
  "01-hello-led": () => [...power(), R("R1", 330, "T+9", "a12"), LED("LED1", "c12", "c14", "red"), W("a14", "T-15")],
  "02-parallel-leds": () => [...power(), R("R1", 330, "T+9", "a12"), LED("LED1", "c12", "c14", "red"), W("a14", "T-15"),
    R("R2", 330, "T+21", "a24"), LED("LED2", "c24", "c26", "green"), W("a26", "T-27")],
  "03-reverse-protect": () => [...power(), { id: "D1", type: "diode", pins: { A: "T+9", K: "a13" } }, R("R1", 330, "c13", "c16"),
    LED("LED1", "d16", "d18", "yellow"), W("a18", "T-17")],
  "04-555-blinker": blinker,
  "05-555-flasher": () => [...blinker(), R("R4", 330, "B+27", "j29"), LED("LED2", "i29", "i32", "green")],
};
const hints = (parts, lv) => E.diagnose(parts, lv).map((h) => h.text.join(" ")).join(" | ");

for (const d of Object.keys(good)) {
  test(`example ${d}: valid, and a correct build passes wiring and behaviour`, () => {
    const doc = C.parse(fs.readFileSync(path.join(EX, d, "circuit.yaml"), "utf8"));
    assert.deepEqual(C.validate(doc), []);
    const lv = load(d), r = E.checkGoal(good[d](), lv);
    assert.equal(r.ok, true, r.why);
    assert.match(r.why, /wired the way the schematic says/);
    assert.deepEqual(E.diagnose(good[d](), lv), [], "a correct build gets no hints");
  });
}

test("identical parts may trade roles; resistors may sit either way round", () => {
  const lv = load("02-parallel-leds");
  const swapped = good["02-parallel-leds"]().map((p) => (p.id === "R1" ? { ...p, id: "R2" } : p.id === "R2" ? { ...p, id: "R1" } : p));
  assert.equal(E.checkGoal(swapped, lv).ok, true, "R1 and R2 are both 330 Ω");
  const turned = good["01-hello-led"]().map((p) => (p.id === "R1" ? { ...p, pins: { 1: p.pins[2], 2: p.pins[1] } } : p));
  assert.equal(E.checkGoal(turned, load("01-hello-led")).ok, true, "a resistor has no polarity");
});

test("an LED the wrong way round is miswired, not just dark", () => {
  const lv = load("01-hello-led");
  const back = good["01-hello-led"]().map((p) => (p.id === "LED1" ? { ...p, pins: { A: p.pins.K, K: p.pins.A } } : p));
  const r = E.checkGoal(back, lv);
  assert.equal(r.ok, false);
  assert.match(hints(back, lv), /Net (A|GND)/);
});

test("a missing ground wire: the GND net is split, and the hint names LED1's cathode", () => {
  const lv = load("01-hello-led"), parts = good["01-hello-led"]().filter((p) => !(p.type === "wire" && p.pins.a === "a14"));
  assert.match(E.checkGoal(parts, lv).why, /Net GND isn't all connected/);
  assert.match(hints(parts, lv), /GND should join .*LED1 short leg \(cathode, −\)/);
});

test("a stray wire that shorts two nets is named as a merge", () => {
  const lv = load("01-hello-led"), parts = [...good["01-hello-led"](), W("b12", "T+10")];   // the LED's anode straight to +
  assert.match(E.checkGoal(parts, lv).why, /Nets (VCC and A|A and VCC) are joined/);
});

test("a pin the schematic leaves free must stay free (the 555's pin 5)", () => {
  const lv = load("04-555-blinker"), parts = [...blinker(), W("a33", "T-33")];
  const r = E.checkGoal(parts, lv);
  assert.equal(r.ok, false); assert.match(r.why, /U1\.5 is connected to net GND/);
});

test("a part still in the bin is named", () => {
  const lv = load("03-reverse-protect"), parts = good["03-reverse-protect"]().filter((p) => p.id !== "D1");
  assert.match(E.checkGoal(parts, lv).why, /D1 isn't on the board yet/);
});

test("the flasher really alternates: LED2 is lit when LED1 isn't", () => {
  const lv = load("05-555-flasher"), r = E.script(good["05-555-flasher"](), lv.supply, 3, () => ({}));
  const both = r.samples.filter((s) => s.leds.every((l) => l.i > 0.002)).length;
  const onlyOne = r.samples.filter((s) => s.leds.filter((l) => l.i > 0.002).length === 1).length;
  assert.ok(onlyOne > r.samples.length * 0.8, `mostly one at a time (${onlyOne}/${r.samples.length})`);
  assert.equal(both, 0, "never both at once");
});

test("bad files get messages that point at the line", () => {
  const bad = C.parse(`
format: strip-and-rail/circuit@1
title: Broken
supply: { v: 5 }
parts:
  R1: { part: resistor }
  U1: { part: ne555 }
  X1: { part: flux-capacitor }
nets:
  VCC: [PSU.+, U1.9, R1.1]
  N2: [R1.1, U1.3]
`);
  const e = C.validate(bad).join("\n");
  assert.match(e, /parts\.R1: a resistor needs a value/);
  assert.match(e, /parts\.X1: part "flux-capacitor" isn't in the library/);
  assert.match(e, /nets\.VCC: "U1\.9": a 555 timer's pins are 1, 2, 3, 4, 5, 6, 7, 8/);
  assert.match(e, /nets\.N2: "R1\.1" is already in net VCC/);
  assert.match(e, /nothing connects to PSU\.-/);
  assert.match(C.validate({}).join(), /format: expected/);
});

test("JSON works as well as YAML", () => {
  const doc = C.parse(JSON.stringify(C.parse(fs.readFileSync(path.join(EX, "01-hello-led", "circuit.yaml"), "utf8"))));
  assert.deepEqual(C.validate(doc), []);
});

test("the horn detector's wake circuit: a horn wakes it, talk doesn't; RV1 turned up, even a horn can't", () => {
  const lv = load("06-horn-wake");
  const C_ = (id, value, a, b, type = "capacitor") => ({ id, type, value, pins: type === "capacitor" ? { 1: a, 2: b } : { "+": a, "-": b } });
  const parts = [W("PSU.+", "T+5"), W("PSU.-", "T-6"), W("T+3", "B+3"), W("T-4", "B-4"),
    { id: "MIC", type: "tone", pins: { VDD: "f10", GND: "f11", OUT: "f12" } }, W("j10", "B+9"), W("j11", "B-11"),
    C_("C1", 1e-6, "h12", "h14"), R("R1", 100000, "i14", "B-15"), { id: "D1", type: "diode", pins: { A: "g14", K: "g18" } },
    C_("C2", 1e-6, "j18", "B-17", "electrolytic"), R("R2", 470000, "i18", "B-21"), W("h18", "g42"),
    R("R3", 330000, "T+27", "a30"), { id: "RV1", type: "pot", value: 100000, pins: { 1: "b30", W: "b31", 3: "b32" } }, W("a32", "T-33"), W("c31", "g41"),
    { id: "U1", type: "lm393", pins: { 1: "f40", 2: "f41", 3: "f42", 4: "f43", 5: "e43", 6: "e42", 7: "e41", 8: "e40" } },
    W("a40", "T+40"), W("j43", "B-43"), W("a43", "T-43"), W("a42", "T+42"), C_("C3", 1e-7, "T+39", "T-39"),
    R("R4", 10000, "B+39", "j40"), { id: "ESP", type: "esp32pin", pins: { GPIO: "f50", GND: "f51" } }, W("i40", "i50"), W("j51", "B-51")];
  const r = E.checkGoal(parts, lv);
  assert.equal(r.ok, true, r.why);
  assert.match(r.why, /Horn: ESP reads HIGH.*Talk: ESP reads LOW/);
  const up = E.checkGoal(parts, lv, { pots: { RV1: 0.001 } });          // threshold at the top of its range
  assert.equal(up.ok, false); assert.match(up.why, /horn-level sound, ESP should read HIGH but reads LOW.*− input at 0\.7/);
  const noPullUp = E.checkGoal(parts.filter((p) => p.id !== "R4"), { ...lv, goal: lv.goal.of[1] });
  assert.equal(noPullUp.ok, false, "open collector: without R4 the pin never goes HIGH");
});
