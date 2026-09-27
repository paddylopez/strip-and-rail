// The calculators: parsing, formatting, and each formula against a hand-worked value and the simulator.
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../src/calc.js");
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("parse: the ways people write component values", () => {
  near(K.parse("4k7"), 4700, 1e-9, "4k7");
  near(K.parse("1000u"), 0.001, 1e-12, "1000u");
  near(K.parse("1000 µF"), 0.001, 1e-12, "1000 µF");
  near(K.parse("10uF"), 1e-5, 1e-15, "10uF");
  near(K.parse("330"), 330, 1e-9, "330");
  near(K.parse("330Ω"), 330, 1e-9, "330Ω");
  near(K.parse("9 mA"), 0.009, 1e-12, "9 mA");
  near(K.parse("2.2k"), 2200, 1e-9, "2.2k");
  near(K.parse("1M"), 1e6, 1e-6, "1M = mega, not milli");
  near(K.parse("4R7"), 4.7, 1e-12, "4R7 (resistor code)"); near(K.parse("100R"), 100, 1e-12, "100R");
  near(K.parse("100K"), 1e5, 1e-6, "KiCad writes 100K"); near(K.parse("0.1uF"), 1e-7, 1e-18, "0.1uF");
  assert.ok(Number.isNaN(K.parse("banana")));
});

test("fmt: three significant figures and an SI prefix", () => {
  assert.equal(K.fmt(0.0091, "A"), "9.1 mA");
  assert.equal(K.fmt(4700, "Ω"), "4.7 kΩ");
  assert.equal(K.fmt(1, "s"), "1 s");
  assert.equal(K.fmt(1.0986, "s"), "1.1 s");
  assert.equal(K.fmt(1e-5, "F"), "10 µF");
  assert.equal(K.fmt(1e-3, "F"), "1000 µF", "capacitors skip milli");
  assert.equal(K.fmt(1e-3, "s"), "1 ms", "other units keep it");
});

test("the question that started it: 1 kΩ × 1000 µF = 1 s", () => {
  near(K.rc(K.parse("1k"), K.parse("1000u")).tau, 1, 1e-12, "tau");
  near(K.rc(1000, 1e-3).left1, 0.368, 0.001, "37% left after one RC");
  near(K.rc(1000, 1e-3).fifth, 1.609, 0.001, "fade to a fifth = RC ln 5 ≈ 1.6 RC (level 6)");
});

test("LED resistor: (5 − 2) ÷ 10 mA = 300 Ω, next standard up is 330 Ω", () => {
  const r = K.ledResistor(5, 2.0, 0.010);
  near(r.r, 300, 1e-9, "exact"); assert.equal(r.std, 330);
  near(r.iStd, 0.00909, 1e-5, "current with 330");
  assert.ok(r.p < 0.25, "well inside a quarter-watt resistor");
  near(K.ledResistor(5, 2.08, 0.0056, 2).r, 150, 2, "level 2: two LEDs at 2.08 V, 5.6 mA -> 150 Ω");
});

test("ohm: any two give the third", () => {
  near(K.ohm(NaN, 0.009, 330).V, 2.97, 1e-9, "V");
  near(K.ohm(3, NaN, 330).I, 0.00909, 1e-5, "I");
  near(K.ohm(3, 0.01, NaN).R, 300, 1e-9, "R");
});

test("e12Up: rounds up to a real resistor", () => {
  assert.equal(K.e12Up(300), 330); assert.equal(K.e12Up(330), 330); assert.equal(K.e12Up(4500), 4700); assert.equal(K.e12Up(9000), 10000);
});

test("555 formulas agree with the simulator's levels", () => {
  near(K.oneshot(100e3, 10e-6).t, 1.0986, 1e-4, "one-shot: R C ln 3 (level 9 measured 1.10 s)");
  const a = K.astable(10e3, 68e3, 10e-6);
  near(a.f, 0.988, 0.002, "astable ≈ 1 Hz (level 10 measured 0.92 Hz)");
  near(1 / Math.LN2, 1.4427, 1e-4, "the 1.44 in the textbook formula is 1 ÷ ln 2");
});

test("divider: equal resistors halve it; the pot at 34% gives 3.3 V", () => {
  near(K.divider(5, 10e3, 10e3).vout, 2.5, 1e-12, "half");
  near(K.divider(5, 3400, 6600).vout, 3.3, 1e-12, "level 12's target");
});
