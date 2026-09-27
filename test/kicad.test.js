// KiCad netlists -> circuit files -> levels. Fixtures are our own circuits written in KiCad's two netlist formats
// (checked against real exports: KiCad 5 "version D" and KiCad 6+ "version E"). A converted netlist must load
// through the same validator as a hand-written file, and a correct breadboard build of it must pass.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const KC = require("../src/kicad.js"), CI = require("../src/circuit.js"), E = require("../src/engine.js");
const FX = path.join(__dirname, "fixtures", "kicad");
const conv = (f, o) => KC.convert(fs.readFileSync(path.join(FX, f), "utf8"), o);
let n = 0;
const W = (a, b) => ({ id: "W" + ++n, type: "wire", pins: { a, b } });
const R = (id, value, a, b) => ({ id, type: "resistor", value, pins: { 1: a, 2: b } });

test("S-expressions: quoted strings, escapes, unquoted atoms, nesting", () => {
  assert.deepEqual(KC.sexpr('(a "b c" (d e) "q\\"x")'), ["a", "b c", ["d", "e"], 'q"x']);
  assert.throws(() => KC.sexpr("(a (b"), /unbalanced/);
  assert.throws(() => KC.convert("(kicad_sch (version 1))"), /isn't a KiCad netlist/);
});

test("KiCad 6+ (version E): power nets become the supply, LED pins by pinfunction, the colour from the value", () => {
  const r = conv("hello-led-v6.net");
  assert.equal(r.ok, true, r.warnings.join(" | "));
  assert.deepEqual(r.doc.parts, { D1: { part: "led", color: "red" }, R1: { part: "resistor", value: "330" } });
  assert.equal(r.doc.supply.v, 5, "+5V says 5 V");
  assert.deepEqual(r.doc.nets["+5V"], ["PSU.+", "R1.1"]);
  assert.deepEqual(r.doc.nets.GND, ["PSU.-", "D1.K"]);
  assert.match(r.yaml, /# KiCad: Net-\(D1-A\)/, "auto-named nets keep their KiCad name as a comment");
  const lv = CI.toLevel(CI.parse(r.yaml));
  assert.deepEqual(CI.validate(CI.parse(r.yaml)), []);
  const build = [W("PSU.+", "T+5"), W("PSU.-", "T-6"), R("R1", 330, "T+9", "a12"), { id: "D1", type: "led", color: "red", pins: { A: "c12", K: "c14" } }, W("a14", "T-15")];
  assert.equal(E.checkGoal(build, lv).ok, true, "a correct build of the imported circuit passes");
});

test("KiCad 5 (version D): unquoted atoms, a battery as the supply, pin 1 of an LED is its cathode, one-pin nets dropped", () => {
  const r = conv("555-blinker-v5.net");
  assert.equal(r.ok, true, r.warnings.join(" | "));
  assert.equal(r.doc.supply.v, 5, "BT1's value 5V");
  assert.equal(r.doc.parts.U1.part, "ne555"); assert.equal(r.doc.parts.C1.part, "electrolytic"); assert.equal(r.doc.parts.C1.value, "10u");
  assert.equal(r.doc.parts.R2.value, "68k", "68K read as 68 kΩ");
  assert.ok(r.doc.nets.GND.includes("D1.K") && r.doc.nets.GND.includes("C1.-"), "LED pin 1 = K; CP pin 2 = −");
  assert.ok(!Object.values(r.doc.nets).flat().includes("U1.5"), "U1 pin 5 was wired to nothing: it's in no net");
  assert.match(r.warnings.join(" "), /D1: .*colour/, "the colour it had to guess is said out loud");
  // the same breadboard build as the 555 blinker example, with KiCad's designators
  const bl = [W("PSU.+", "T+5"), W("PSU.-", "T-6"), W("T+3", "B+3"), W("T-4", "B-4"),
    { id: "U1", type: "ne555", pins: { 1: "f30", 2: "f31", 3: "f32", 4: "f33", 5: "e33", 6: "e32", 7: "e31", 8: "e30" } },
    W("j30", "B-30"), W("a30", "T+30"), W("j33", "B+33"), R("R1", 10000, "T+27", "a31"), R("R2", 68000, "b31", "b35"), W("c35", "c32"), W("g31", "d32"),
    { id: "C1", type: "electrolytic", value: 10e-6, pins: { "+": "j31", "-": "B-31" } }, R("R3", 330, "g32", "g36"),
    { id: "D1", type: "led", color: "red", pins: { A: "h36", K: "h38" } }, W("j38", "B-39")];
  const lv = CI.toLevel(CI.parse(r.yaml));
  assert.equal(E.checkGoal(bl, lv).ok, true, E.checkGoal(bl, lv).why);
});

test("a part the game doesn't have yet is left out, said so, and ok is false; 4R7 reads as 4.7 Ω", () => {
  const r = conv("unsupported-v6.net");
  assert.equal(r.ok, false);
  assert.match(r.warnings[0], /Left out .*Q1 \(Transistor_BJT:2N3904/);
  assert.equal(r.doc.parts.R1.value, "4.7");
  assert.equal(r.doc.parts.D1.color, "blue");
  assert.equal(r.doc.supply.v, 3.3, "+3V3 says 3.3 V");
  assert.deepEqual(r.doc.nets["+3V3"], ["PSU.+", "R1.1"], "+3V3 keeps its name");
  assert.ok(!r.doc.parts.Q1);
});

test("the CLI: exit 0 clean, 1 when something needs a human, 2 when it can't read the file", () => {
  const { spawnSync } = require("child_process");
  const run = (f) => spawnSync(process.execPath, [path.join(__dirname, "..", "tools", "kicad2circuit.js"), f], { encoding: "utf8" });
  assert.equal(run(path.join(FX, "hello-led-v6.net")).status, 0);
  const u = run(path.join(FX, "unsupported-v6.net"));
  assert.equal(u.status, 1); assert.match(u.stdout, /format: strip-and-rail\/circuit@1/); assert.match(u.stderr, /Left out/);
  assert.equal(run(__filename).status, 2);
});
