/* Strip & Rail: the bench calculators. Pure functions, each the formula a Rulebook theorem proves (see rules.js),
 * plus the parsing and formatting that let you type "4k7", "1000u" or "10 µF". Node-testable. */
(function (root) {
  "use strict";
  const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };

  /** "4k7" -> 4700, "1000u" -> 0.001, "10 µF" -> 1e-5, "330" -> 330, "9 mA" -> 0.009. NaN if it isn't a number. */
  function parse(text) {
    let s = String(text).trim().replace(/,/g, "").replace(/\s+/g, "");
    s = s.replace(/(ohms?|Ω|F|V|A|s|Hz)$/i, (u) => (/^(m|M)$/.test(u) ? u : ""));   // drop a trailing unit
    let m = s.match(/^(\d+)([pnuµμmkKMG])(\d+)$/);                                    // 4k7 = 4.7k
    if (m) return parseFloat(m[1] + "." + m[3]) * PREFIX[m[2]];
    m = s.match(/^(\d+)[Rr](\d*)$/);                                                   // 4R7 = 4.7 ohm, 100R = 100
    if (m) return parseFloat(m[1] + "." + (m[2] || "0"));
    m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)([pnuµμmkKMG]?)$/i);
    if (!m) return NaN;
    return parseFloat(m[1]) * PREFIX[m[2]];
  }

  /** 3 significant figures with an SI prefix: 0.0091 A -> "9.1 mA", 4700 Ω -> "4.7 kΩ". */
  function fmt(v, unit) {
    if (!isFinite(v)) return "—";
    if (v === 0) return "0 " + unit;
    const steps = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
    const a = Math.abs(v);
    // capacitors are never written in millifarads at the bench: 1000 µF, not 1 mF
    const use = unit === "F" ? steps.filter(([, p]) => p !== "m") : steps;
    const [f, p] = use.find(([f]) => a >= f * 0.9995) || use[use.length - 1];
    return +(v / f).toPrecision(3) + " " + p + unit;
  }

  const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  /** The next standard (E12) resistor at or above r: rounding UP means a little less current, the safe side. */
  function e12Up(r) {
    if (!(r > 0)) return NaN;
    const dec = Math.pow(10, Math.floor(Math.log10(r)));
    for (const k of E12) if (k * dec >= r * (1 - 1e-9)) return +(k * dec).toPrecision(3);
    return 10 * dec;
  }

  // ---- the formulas (each is a theorem in rules.js) ----
  /** LED resistor: R = (Vs − n·Vf) ÷ I; the next E12 value up, the current it gives, and the power in it. */
  function ledResistor(vs, vf, i, n = 1) {
    const vr = vs - n * vf, r = vr / i, std = e12Up(r);
    const iStd = vr / std;
    return { r, vr, std, iStd, p: iStd * iStd * std, ok: vr > 0 };
  }
  /** Ohm's law: give any two of V, I, R (the third as NaN) and get all three, plus the power. */
  function ohm(V, I, R) {
    if (isNaN(V)) V = I * R; else if (isNaN(I)) I = V / R; else if (isNaN(R)) R = V / I;
    return { V, I, R, P: V * I };
  }
  /** R × C: the time constant, and what it means for a draining (or filling) capacitor. */
  function rc(R, C) {
    const tau = R * C;
    return { tau, left1: Math.exp(-1), fifth: tau * Math.log(5), five: 5 * tau, left5: Math.exp(-5) };
  }
  /** 555 one-shot: C charges toward VCC and the output ends at 2/3 VCC: t = R C ln 3 ≈ 1.1 R C. */
  function oneshot(R, C) { return { t: R * C * Math.log(3) }; }
  /** 555 astable: high = (R1+R2) C ln 2, low = R2 C ln 2, f = 1 / (ln 2 (R1 + 2 R2) C). */
  function astable(R1, R2, C) {
    const high = (R1 + R2) * C * Math.LN2, low = R2 * C * Math.LN2, T = high + low;
    return { high, low, T, f: 1 / T, duty: high / T };
  }
  /** Voltage divider: Vout = Vin × R2 ÷ (R1 + R2), unloaded; the current through the pair. */
  function divider(vin, R1, R2) { return { vout: vin * R2 / (R1 + R2), i: vin / (R1 + R2) }; }

  const api = { parse, fmt, e12Up, ledResistor, ohm, rc, oneshot, astable, divider };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BenchCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
