// Engine tests: every level has a known-good build that must pass, and the classic mistakes must fail
// with the hint that names them. Run: node --test test/
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/engine.js");
const { LEVELS } = require("../src/levels.js");
const L = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

let n = 0;
const wire = (a, b) => ({ id: "W" + ++n, type: "wire", pins: { a, b } });
const R = (id, value, p1, p2) => ({ id, type: "resistor", value, pins: { 1: p1, 2: p2 } });
const LED = (id, A, K, color = "red") => ({ id, type: "led", color, pins: { A, K } });
const power = () => [wire("PSU.+", "T+5"), wire("PSU.-", "T-6")];
const hintsText = (parts, level) => E.diagnose(parts, level).map((h) => h.text.join(" ")).join(" | ");

const bridges = () => [wire("T+3", "B+3"), wire("T-4", "B-4")];
const chip555 = () => ({ id: "U1", type: "ne555", pins: { 1: "f30", 2: "f31", 3: "f32", 4: "f33", 5: "e33", 6: "e32", 7: "e31", 8: "e30" } });
const glow = (r, c) => [...power(), { id: "SW1", type: "button", pins: { 1: "T+9", 2: "b10" } },
  { id: "C1", type: "electrolytic", value: c, pins: { "+": "d10", "-": "d12" } }, wire("a12", "T-11"),
  R("R1", r, "e10", "e13"), LED("LED1", "b13", "b15"), wire("a15", "T-15")];
const good = {
  light: () => [...power(), R("R1", 330, "T+9", "a12"), LED("LED1", "c12", "c14"), wire("a14", "T-15")],
  series: () => [...power(), R("R1", 150, "T+9", "a12"), LED("LED1", "c12", "c14", "green"), LED("LED2", "d14", "d16", "green"), wire("a16", "T-15")],
  button: () => [...power(), R("R1", 330, "T+9", "a12"), { id: "SW1", type: "button", pins: { 1: "c12", 2: "c14" } },
    LED("LED1", "d14", "d16", "yellow"), wire("a16", "T-15")],
  dimmer: () => [...power(), R("R1", 220, "T+19", "b20"), { id: "RV1", type: "pot", value: 10000, pins: { 1: "a20", W: "a21", 3: "a22" } },
    LED("LED1", "c21", "c23", "blue"), wire("a23", "T-23")],
  blink: () => [...power(), wire("T+3", "B+3"), wire("T-4", "B-4"),
    { id: "U1", type: "ne555", pins: { 1: "f30", 2: "f31", 3: "f32", 4: "f33", 5: "e33", 6: "e32", 7: "e31", 8: "e30" } },
    wire("j30", "B-30"), wire("a30", "T+30"), wire("j33", "B+33"),
    R("R1", 10000, "T+27", "a31"), R("R2", 68000, "b31", "b35"), wire("c35", "c32"), wire("g31", "d32"),
    { id: "C1", type: "electrolytic", value: 10e-6, pins: { "+": "j31", "-": "B-31" } },
    R("R3", 330, "g32", "g36"), LED("LED1", "h36", "h38"), wire("j38", "B-39")],
  gap: () => [...L.gap.preset.map((p) => ({ ...p, pins: { ...p.pins } })), wire("T+3", "B+3"), wire("T-4", "B-4")],
  ammeter: () => L.ammeter.preset.filter((p) => !p.free).map((p) => ({ ...p, pins: { ...p.pins } })),    // W3 pulled: the gap
  afterglow: () => glow(330, 1000e-6),
  rctime: () => glow(1000, 1000e-6),
  chip: () => [...power(), ...bridges(), chip555(), wire("j30", "B-30"), wire("a30", "T+30"), wire("j33", "B+33"),
    wire("j31", "B-31"), wire("a32", "T-33"), R("R3", 330, "g32", "g36"), LED("LED1", "h36", "h38"), wire("j38", "B-39")],
  latch: () => [...power(), ...bridges(), chip555(), wire("j30", "B-30"), wire("a30", "T+30"), wire("a32", "T-33"),
    R("R1", 10000, "B+27", "j31"), { id: "SW1", type: "button", pins: { 1: "i31", 2: "B-31" } },
    R("R2", 10000, "B+35", "j33"), { id: "SW2", type: "button", pins: { 1: "i33", 2: "B-33" } },
    R("R3", 330, "g32", "g36"), LED("LED1", "h36", "h38", "green"), wire("j38", "B-39")],
  oneshot: () => [...power(), ...bridges(), chip555(), wire("j30", "B-30"), wire("a30", "T+30"), wire("j33", "B+33"),
    R("R1", 10000, "B+27", "j31"), { id: "SW1", type: "button", pins: { 1: "i31", 2: "B-31" } },
    wire("b31", "b32"), R("R2", 100000, "T+27", "a31"), { id: "C1", type: "electrolytic", value: 10e-6, pins: { "+": "d32", "-": "d34" } }, wire("a34", "T-33"),
    R("R3", 330, "g32", "g36"), LED("LED1", "h36", "h38", "yellow"), wire("j38", "B-39")],
  divider: () => [...power(), { id: "RV1", type: "pot", value: 10000, pins: { 1: "a20", W: "a21", 3: "a22" } },
    wire("b20", "T+19"), wire("b22", "T-23")],
};
const goodState = { divider: { pots: { RV1: 0.34 } }, ammeter: { meter: { mode: "A", probes: ["b14", "T-17"] } } };    // pin 1 on +: the wiper reads 5 V x (1 - pos) = 3.3 V

test("board rules: strips, rails, the channel", () => {
  assert.equal(E.stripOf("a12"), E.stripOf("e12"));
  assert.notEqual(E.stripOf("e12"), E.stripOf("f12"), "the centre channel separates e and f");
  assert.equal(E.stripOf("T+3"), E.stripOf("T+61"));
  assert.notEqual(E.stripOf("T+3"), E.stripOf("B+3"), "top and bottom rails are separate");
  assert.equal(E.isHole("T+8"), false, "every sixth rail position is a gap");
  assert.equal(E.allHoles().length, 630 + 200);
});

test("footprints: spans, chips, pots", () => {
  assert.ok(E.footprint("resistor", "a1", "a2").error, "a resistor can't sit in adjacent holes");
  assert.ok(E.footprint("resistor", "a1", "a20").error, "or reach 19 holes");
  assert.deepEqual(E.footprint("led", "c12", "c14").pins, { A: "c12", K: "c14" });
  const u = E.footprint("ne555", "f30").pins;
  assert.equal(u["1"], "f30"); assert.equal(u["8"], "e30"); assert.equal(u["4"], "f33"); assert.equal(u["5"], "e33");
  assert.ok(E.footprint("ne555", "T+30").error);
  assert.deepEqual(E.footprint("pot", "a20").pins, { 1: "a20", W: "a21", 3: "a22" });
  assert.deepEqual(E.footprint("wire", "PSU.+", "T+5").pins, { a: "PSU.+", b: "T+5" }, "wires reach the supply terminals");
  assert.deepEqual(E.footprint("wire", "T-6", "PSU.-").pins, { a: "T-6", b: "PSU.-" });
  assert.ok(E.footprint("resistor", "PSU.+", "T+5").error, "only wires do");
  assert.ok(E.footprint("wire", "PSU.+", "PSU.+").error);
});

test("solver: Ohm's law through a resistor and a red LED", () => {
  const r = E.trial(good.light(), L.light.supply);
  const i = r.leds[0].i;
  assert.ok(i > 0.0085 && i < 0.0095, `LED current ${i}`);
  assert.equal(r.supply.mode, "CV");
  assert.ok(Math.abs(r.supply.v - 5) < 0.01);
});

for (const lv of LEVELS) {
  test(`level "${lv.id}": the known-good build passes`, () => {
    const res = E.checkGoal(good[lv.id](), lv, goodState[lv.id]);
    assert.equal(res.ok, true, res.why);
    const withMeter = [...good[lv.id](), E.meterPart(goodState[lv.id]?.meter)].filter(Boolean);
    assert.deepEqual(E.diagnose(withMeter, lv), [], "a working build gets no hints");
  });
}

test("blink runs at ~1 Hz (1.44 / ((R1 + 2 R2) C))", () => {
  const res = E.checkGoal(good.blink(), L.blink);
  const f = +res.why.match(/([\d.]+) Hz/)[1];
  assert.ok(f > 0.8 && f < 1.2, res.why);
});

test("no resistor: the LED burns out, and the hint says why", () => {
  const parts = [...power(), LED("LED1", "c12", "c14"), wire("a12", "T+9"), wire("a14", "T-15")];
  const res = E.checkGoal(parts, L.light);
  assert.equal(res.ok, false); assert.match(res.why, /burned out/);
  assert.match(hintsText(parts, L.light), /resistor in series/);
});

test("backwards LED: dark, and the hint says flip it", () => {
  const parts = [...power(), R("R1", 330, "T+9", "a12"), LED("LED1", "c14", "c12"), wire("a14", "T-15")];
  assert.equal(E.checkGoal(parts, L.light).ok, false);
  assert.match(hintsText(parts, L.light), /backwards/);
});

test("both legs in one strip: the part is bypassed", () => {
  const parts = [...power(), R("R1", 330, "T+9", "a12"), LED("LED1", "b12", "e12"), wire("a14", "T-15")];
  assert.match(hintsText(parts, L.light), /LED1's legs are in the same strip/);
});

test("the gap level: unbridged bottom rails are named", () => {
  const parts = L.gap.preset.map((p) => ({ ...p, pins: { ...p.pins } }));
  assert.equal(E.checkGoal(parts, L.gap).ok, false);
  assert.match(hintsText(parts, L.gap), /top and bottom rails are separate/);
});

test("a wire from + to −: the supply goes to CC and the hint says short", () => {
  const parts = [...good.light(), wire("T+21", "T-22")];
  const r = E.trial(parts, L.light.supply);
  assert.equal(r.supply.mode, "CC");
  assert.ok(r.supply.v < 0.1);
  assert.match(hintsText(parts, L.light), /short/);
});

test("supply not connected: the first hint is about the supply", () => {
  const parts = [R("R1", 330, "T+9", "a12"), LED("LED1", "c12", "c14"), wire("a14", "T-15")];
  assert.match(E.diagnose(parts, L.light)[0].text[0], /getting power/);
});

test("the 555 with RESET floating: held in reset, named", () => {
  const parts = good.blink().filter((p) => !(p.type === "wire" && p.pins.a === "j33"));
  assert.equal(E.checkGoal(parts, L.blink).ok, false);
  assert.match(hintsText(parts, L.blink), /RESET|pin 4/);
});

test("dimmer without the fixed resistor burns the LED at one end of the knob", () => {
  const parts = [...power(), wire("T+19", "a20"), { id: "RV1", type: "pot", value: 10000, pins: { 1: "b20", W: "b21", 3: "b22" } },
    LED("LED1", "c21", "c23", "blue"), wire("a23", "T-23")];
  const res = E.checkGoal(parts, L.dimmer);
  assert.equal(res.ok, false); assert.match(res.why, /burns out/);
});

test("button: lit only while held", () => {
  const parts = good.button();
  const up = E.trial(parts, L.button.supply), down = E.trial(parts, L.button.supply, { pressed: { SW1: true } });
  assert.ok(up.leds[0].i < 1e-4); assert.ok(down.leds[0].i > 0.005);
});

test("divider: one end floating, wiper on a rail, knob off target -- each named", () => {
  const oneEnd = good.divider().filter((p) => !(p.type === "wire" && p.pins.a === "b22"));
  assert.match(E.checkGoal(oneEnd, L.divider, goodState.divider).why, /both end legs/);
  assert.match(hintsText(oneEnd, L.divider), /right leg/, "the lonely end leg gets a hint");
  const wiperOnRail = [...power(), { id: "RV1", type: "pot", value: 10000, pins: { 1: "a20", W: "a21", 3: "a22" } },
    wire("b20", "T+19"), wire("b21", "T-21")];
  assert.match(E.checkGoal(wiperOnRail, L.divider, goodState.divider).why, /shorts \+ to −/);
  const off = E.checkGoal(good.divider(), L.divider, { pots: { RV1: 0.5 } });
  assert.equal(off.ok, false); assert.match(off.why, /sits at 2\.50 V.*until the meter reads 3\.3 V/);
});

test("readings: one current around a series loop, voltages that add up to the supply", () => {
  const r = E.trial(good.series(), L.series.supply), sim = r.sim;
  const R1 = sim.reading("R1"), D1 = sim.reading("LED1"), D2 = sim.reading("LED2");
  for (const x of [D1, D2]) assert.ok(Math.abs(x.i - R1.i) < 1e-6, `series current ${x.i} vs ${R1.i}`);
  assert.ok(Math.abs(R1.v + D1.v + D2.v - r.supply.v) < 1e-3, "Kirchhoff's voltage law around the loop");
});

test("readings: a divider's wiper, and a capacitor's current while it charges", () => {
  const d = E.trial(good.divider(), L.divider.supply, { pots: { RV1: 0.34 } }).sim.reading("RV1");
  assert.ok(Math.abs(d.vw - 3.3) < 0.02, `wiper ${d.vw}`);
  assert.ok(Math.abs(d.iW) < 1e-6, "nothing loads the wiper, so no current leaves it");
  const b = E.trial(good.blink(), L.blink.supply, { seconds: 0.05 }).sim.reading("C1");
  assert.ok(b.i > 1e-6 && b.v > 0, `C1 charging: ${b.i} A at ${b.v} V`);
});

test("ammeter: in the gap it reads the LED's current; the classic mistakes are named", () => {
  const ok = E.checkGoal(good.ammeter(), L.ammeter, goodState.ammeter);
  assert.equal(ok.ok, true, ok.why); assert.match(ok.why, /9\.\d mA/);
  const built = L.ammeter.preset.map((p) => ({ ...p, pins: { ...p.pins } }));        // loop still closed by W3
  const m = (probes, mode = "A") => ({ meter: { mode, probes } });
  assert.match(E.checkGoal(built, L.ammeter, m(["b12", "b14"])).why, /in parallel/, "across the LED: it goes dark");
  assert.match(E.checkGoal(built, L.ammeter, m(["T+21", "T-22"])).why, /fuse blew/, "across the supply: the fuse");
  assert.match(E.checkGoal(built, L.ammeter, m(["b14", "T-17"])).why, /same conductor/, "next to the wire: reads 0");
  assert.match(E.checkGoal(good.ammeter(), L.ammeter, m(["b14", "T-17"], "V")).why, /Switch it to A/);
  const swapped = E.checkGoal(good.ammeter(), L.ammeter, m(["T-17", "b14"]));
  assert.equal(swapped.ok, true); assert.match(swapped.why, /probes swapped/);
});

test("the curve: levels 5-9 teach one idea each, and the 555 blink is the level-10 boss", () => {
  assert.deepEqual(LEVELS.map((l) => l.id).slice(4, 10), ["afterglow", "rctime", "chip", "latch", "oneshot", "blink"]);
  assert.equal(LEVELS[9].boss, true);
});

test("afterglow / time it: the glow scales with R x C; no capacitor, no glow", () => {
  const t1 = +E.checkGoal(glow(1000, 1000e-6), L.rctime).why.match(/in ([\d.]+) s/)[1];
  const t2 = +E.checkGoal(glow(2200, 1000e-6), L.rctime).why.match(/in ([\d.]+) s/)[1];
  assert.ok(t2 / t1 > 2 && t2 / t1 < 2.4, `2.2x the R, ${(t2 / t1).toFixed(2)}x the glow`);
  assert.match(E.checkGoal(glow(330, 1000e-6), L.rctime).why, /wants 1.2–4 s.*bigger/);
  const noCap = glow(330, 1000e-6).filter((p) => p.id !== "C1");
  assert.match(E.checkGoal(noCap, L.afterglow).why, /instant you let go/);
});

test("meet the 555: RESET left floating holds it off, and says so", () => {
  const parts = good.chip().filter((p) => !(p.type === "wire" && p.pins.a === "j33"));
  assert.equal(E.checkGoal(parts, L.chip).ok, false);
  assert.match(hintsText(parts, L.chip), /RESET|pin 4/);
  assert.doesNotMatch(hintsText(good.chip(), L.chip), /pins 2 \(TRIG\) and 6/, "the join-2-and-6 hint is the boss level's only");
});

test("set and reset: a button with no pull-up gets the pull-up hint", () => {
  const parts = good.latch().filter((p) => p.id !== "R1");
  assert.equal(E.checkGoal(parts, L.latch).ok, false);
  assert.match(hintsText(parts, L.latch), /pull-up/);
});

test("one-shot: the pulse is ~1.1 R C; without the capacitor it never ends", () => {
  const ok = E.checkGoal(good.oneshot(), L.oneshot), s = +ok.why.match(/([\d.]+) s/)[1];
  assert.ok(s > 0.95 && s < 1.3, ok.why);
  assert.match(E.checkGoal(good.oneshot().filter((p) => p.id !== "C1"), L.oneshot).why, /only while the button is held/);
  const unjoined = good.oneshot().filter((p) => !(p.type === "wire" && p.pins.a === "b31"));   // pins 6 and 7 not joined
  assert.match(E.checkGoal(unjoined, L.oneshot).why, /never goes out/);
});

test("the LM393: each output lets go when IN+ > IN−, pulls low otherwise; a pull-up makes the HIGH", () => {
  const U = { id: "U1", type: "lm393", pins: { 1: "f40", 2: "f41", 3: "f42", 4: "f43", 5: "e43", 6: "e42", 7: "e41", 8: "e40" } };
  const base = [...power(), U, wire("a40", "T+40"), wire("j43", "T-15"), wire("a43", "T-43"), wire("a42", "T+42"),
    R("R4", 10000, "T+37", "j40")];                                       // pull-up on OUT A
  const hi = E.trial([...base, wire("j42", "T+45"), wire("j41", "T-45")], { v: 3.3 }, { seconds: 0.01 }).sim;   // IN+ high, IN− low
  const lo = E.trial([...base, wire("j42", "T-45"), wire("j41", "T+45")], { v: 3.3 }, { seconds: 0.01 }).sim;
  assert.ok(hi.voltageAt("i40") > 3.2, `IN+ > IN−: output pulled up to ${hi.voltageAt("i40")}`);
  assert.ok(lo.voltageAt("i40") < 0.3, `IN+ < IN−: output pulled low to ${lo.voltageAt("i40")}`);
});

test("the tone source: 1.25 V offset, the sound picks the swing; no VDD, no output", () => {
  const MIC = { id: "MIC", type: "tone", pins: { VDD: "f10", GND: "f11", OUT: "f12" } };
  const parts = [...power(), wire("T+3", "B+3"), wire("T-4", "B-4"), MIC, wire("j10", "B+9"), wire("j11", "B-11"), R("RL", 100000, "j12", "B-15")];
  for (const [sound, amp] of [["horn", 1.0], ["talk", 0.2]]) {
    const sim = new E.Sim(parts, { v: 3.3 }); sim.sound = sound;
    let mx = -9, mn = 9; for (let k = 0; k < 400; k++) { sim.step(); const v = sim.voltageAt("i12"); mx = Math.max(mx, v); mn = Math.min(mn, v); }
    assert.ok(Math.abs((mx + mn) / 2 - 1.25) < 0.02 && Math.abs((mx - mn) / 2 - amp) < 0.02, `${sound}: ${mn.toFixed(3)}..${mx.toFixed(3)}`);
    assert.equal(sim.dt, 1e-4, "a tone source on the board steps the simulator at 10 kHz");
  }
  const dead = new E.Sim(parts.filter((p) => !(p.type === "wire" && p.pins.a === "j10")), { v: 3.3 }); dead.sound = "horn"; dead.run(0.01);
  assert.ok(Math.abs(dead.voltageAt("i12")) < 0.01, "unpowered, it's silent");
});
