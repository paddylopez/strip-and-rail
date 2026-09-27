/* bench-sim engine: the breadboard's rules, the parts, and a real circuit solver.
 *
 * Board: the bench's 830-point breadboard. Columns 1-63; rows a-e are one strip per column, f-j another;
 * the four rails (T-, T+ top, B-, B+ bottom) are each one strip along the board, in groups of five holes.
 * Nothing crosses the centre channel, and the top rails are not joined to the bottom ones.
 *
 * Solver: modified nodal analysis, Newton iterations for diodes/LEDs, backward-Euler time steps for
 * capacitors, and a behavioural 555. The bench supply behaves like a lab supply: constant voltage until the current
 * limit, then constant current (a short shows as CC with the voltage collapsed, like the real one).
 *
 * Works in the browser (window.BenchEngine) and in node (require) for the tests.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- board geometry
  const COLS = 63;
  const ROWS_TOP = ["a", "b", "c", "d", "e"];
  const ROWS_BOT = ["f", "g", "h", "i", "j"];
  const RAILS = ["T-", "T+", "B-", "B+"];
  // y of each row in pitches (0.1 in) from the board's top edge
  const ROW_Y = { "T-": 1.2, "T+": 2.2, a: 4.2, b: 5.2, c: 6.2, d: 7.2, e: 8.2,
    f: 11.2, g: 12.2, h: 13.2, i: 14.2, j: 15.2, "B-": 17.2, "B+": 18.2 };
  const railHas = (c) => c >= 3 && c <= 61 && (c - 3) % 6 !== 5;

  function parseHole(id) {
    for (const r of RAILS) {
      if (id.startsWith(r)) {
        const c = +id.slice(r.length);
        return Number.isInteger(c) && railHas(c) ? { row: r, col: c, rail: true } : null;
      }
    }
    const r = id[0], c = +id.slice(1);
    if (!(r in ROW_Y) || !Number.isInteger(c) || c < 1 || c > COLS) return null;
    return { row: r, col: c, rail: false };
  }
  const isHole = (id) => parseHole(id) !== null;
  const isTerminal = (id) => id.includes(".");          // off-board: "PSU.+", "PSU.-"

  /** The strip a point belongs to: every hole in one strip is one conductor. */
  function stripOf(id) {
    if (isTerminal(id)) return "term:" + id;
    const h = parseHole(id);
    if (!h) throw new Error("not a hole: " + id);
    if (h.rail) return "rail:" + h.row;
    return (ROWS_TOP.includes(h.row) ? "top:" : "bot:") + h.col;
  }

  /** Human words for a strip, for hints. */
  function describeStrip(key) {
    const [kind, v] = key.split(":");
    if (kind === "rail") {
      const side = v[0] === "T" ? "top" : "bottom", sign = v[1] === "+" ? "+ (red)" : "− (blue)";
      return `the ${side} ${sign} rail`;
    }
    if (kind === "top") return `column ${v}, rows a–e`;
    if (kind === "bot") return `column ${v}, rows f–j`;
    return v === "PSU.+" ? "the supply's red (+) terminal" : v === "PSU.-" ? "the supply's black (−) terminal" : v;
  }

  function allHoles() {
    const out = [];
    for (const r of Object.keys(ROW_Y)) {
      for (let c = 1; c <= COLS; c++) {
        if (RAILS.includes(r) && !railHas(c)) continue;
        out.push(r + c);
      }
    }
    return out;
  }

  /** Distance between two holes, in pitches. */
  function span(a, b) {
    const A = parseHole(a), B = parseHole(b);
    return Math.hypot(A.col - B.col, ROW_Y[A.row] - ROW_Y[B.row]);
  }

  // ---------------------------------------------------------------- parts (from data/parts/*.json)
  // A part's data says where its legs go (footprint), what its pins are called, and which electrical model
  // runs it (model.kind); the solver below implements each kind. Adding a part of an existing kind is data only.
  const DATA = typeof module !== "undefined" && module.exports ? require("./data.js") : root.BenchData;
  const LIB = DATA.PARTS;
  const TYPES = {};
  for (const d of Object.values(LIB)) {
    const f = d.footprint;
    TYPES[d.id] = { name: d.name, leads: d.pins.map((x) => x.id), prefix: d.prefix,
      span: f.kind === "two-lead" ? f.span : undefined, dip: f.kind === "dip" ? f.pins : undefined, row: f.kind === "row" };
  }
  // the multimeter in amps mode: not placed from the bin -- its probes ARE its leads (see meterPart)
  TYPES.ammeter = { name: "Multimeter (amps)", leads: ["+", "-"], prefix: "METER" };
  const PIN_DEFS = { ammeter: { "+": { name: "red probe" }, "-": { name: "black probe" } } };
  for (const d of Object.values(LIB)) PIN_DEFS[d.id] = Object.fromEntries(d.pins.map((x) => [x.id, x]));
  const pinDef = (p, pin) => (PIN_DEFS[p.type] && PIN_DEFS[p.type][pin]) || {};
  const pinName = (p, pin) => pinDef(p, pin).name || `leg ${pin}`;
  /** The electrical model a placed part runs: its part's model.kind ("led", "capacitor", "ne555"...). */
  const kindOf = (p) => (LIB[p.type] ? LIB[p.type].model.kind : p.type);
  const modelOf = (p) => (LIB[p.type] ? LIB[p.type].model : {});
  const polarised = (p) => !!modelOf(p).polarised;

  const LED_COLORS = LIB.led.params.color.options;   // forward voltage at ~10 mA, and the glow colour
  const LED_MAX = LIB.led.model.iMax;                // absolute max continuous current
  const LED_BURN = LIB.led.model.iBurn;              // above this for 20 ms, it burns out

  /** The holes a part would occupy, given where its first lead goes (and second, for 2-lead parts).
   *  Returns {pins:{name:hole}} or {error}. */
  function footprint(type, first, second) {
    const T = TYPES[type];
    if (isTerminal(first) || (second !== undefined && isTerminal(second))) {
      if (type !== "wire") return { error: "Only wires reach the supply's terminals." };
      if (second === undefined) return { pending: true };
      if (first === second) return { error: "Both ends can't go on the same terminal." };
      if (!isTerminal(first) && !parseHole(first) || !isTerminal(second) && !parseHole(second)) return { error: "That isn't a hole." };
      return { pins: { a: first, b: second } };
    }
    const A = parseHole(first);
    if (!A) return { error: "That isn't a hole." };
    if (T.dip) {
      // straddles the channel, notch left: pin 1 at f<col>, pins 1..n/2 along f, then back along e
      if (A.rail) return { error: "A chip straddles the centre channel: click in row e or f." };
      const half = T.dip / 2, col = A.col;
      if (col + half - 1 > COLS) return { error: "Too close to the right edge." };
      const pins = {};
      for (let i = 0; i < half; i++) { pins[String(i + 1)] = "f" + (col + i); pins[String(T.dip - i)] = "e" + (col + i); }
      return { pins };
    }
    if (T.row) {                                                // legs in a line, in consecutive columns
      if (A.rail) return { error: `Put the ${T.name.toLowerCase()}'s legs in a terminal row (a–j), not a rail.` };
      if (A.col + T.leads.length - 1 > COLS) return { error: "Too close to the right edge." };
      return { pins: Object.fromEntries(T.leads.map((k, i) => [k, A.row + (A.col + i)])) };
    }
    if (second === undefined) return { pending: true };
    if (!parseHole(second)) return { error: "That isn't a hole." };
    if (first === second) return { error: "Both legs can't share one hole." };
    const d = span(first, second);
    if (d < T.span[0]) return { error: `Too close together for a ${T.name.toLowerCase()}.` };
    if (d > T.span[1]) return { error: `A ${T.name.toLowerCase()}'s legs don't reach that far (max ${Math.floor(T.span[1])} holes).` };
    return { pins: { [T.leads[0]]: first, [T.leads[1]]: second } };
  }

  // ---------------------------------------------------------------- nets
  /** Union the strips: wires join two strips, holes in one strip are already one. */
  function buildNets(parts) {
    const parent = new Map();
    const find = (k) => { if (!parent.has(k)) parent.set(k, k); let r = k; while (parent.get(r) !== r) r = parent.get(r);
      let c = k; while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    find("term:PSU.+"); find("term:PSU.-");
    for (const p of parts) {
      for (const h of Object.values(p.pins)) find(stripOf(h));
      if (kindOf(p) === "wire") union(stripOf(p.pins.a), stripOf(p.pins.b));
    }
    const groups = () => { const m = new Map(); for (const k of parent.keys()) { const r = find(k); if (!m.has(r)) m.set(r, []); m.get(r).push(k); } return m; };
    return { netOf: (point) => find(stripOf(point)), stripsIn: (net) => [...parent.keys()].filter((k) => find(k) === net), groups };
  }

  // ---------------------------------------------------------------- the solver
  const VT = 0.02585;
  const GMIN = 1e-9;

  function pnjlim(vnew, vold, vt, vcrit) {       // SPICE's junction voltage limiting
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
      if (vold > 0) { const arg = 1 + (vnew - vold) / vt; vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit; }
      else vnew = vt * Math.log(vnew / vt);
    }
    return vnew;
  }

  function solveLinear(A, b) {                 // Gaussian elimination, partial pivoting (dense, small n)
    const n = b.length;
    for (let k = 0; k < n; k++) {
      let p = k, m = Math.abs(A[k][k]);
      for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i][k]); if (v > m) { m = v; p = i; } }
      if (m < 1e-18) return null;
      if (p !== k) { [A[k], A[p]] = [A[p], A[k]]; [b[k], b[p]] = [b[p], b[k]]; }
      for (let i = k + 1; i < n; i++) {
        const f = A[i][k] / A[k][k];
        if (f === 0) continue;
        for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
        b[i] -= f * b[k];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
    return x;
  }

  /**
   * A running simulation of one build.
   *   supply: {v: volts, ilim: amps}
   *   state carried between rebuilds by part id: capacitor voltages, 555 flip-flop, LED burn-out.
   */
  class Sim {
    constructor(parts, supply, opts = {}) {
      this.supply = { v: 5, ilim: 0.1, ...supply };
      this.fixedDt = opts.dt;
      this.dt = opts.dt || 5e-4;
      this.t = 0;
      this.sound = "off";                      // what any tone source is playing: off | talk | horn
      this.state = { capV: {}, capI: {}, q555: {}, cmp: {}, burnt: {}, stress: {} };
      this.pressed = {};                       // button id -> bool
      this.potPos = {};                        // pot id -> 0..1
      this.rebuild(parts);
    }

    rebuild(parts) {
      this.parts = parts;
      const nets = buildNets(parts);
      this.nets = nets;
      const gnd = nets.netOf("PSU.-");
      const index = new Map();
      let n = 0;
      const node = (point) => { const k = nets.netOf(point); if (k === gnd) return -1; if (!index.has(k)) index.set(k, n++); return index.get(k); };
      const internal = () => n++;
      this.pNode = node("PSU.+");
      const els = [];
      for (const p of parts) {
        if (p.burnt) this.state.burnt[p.id] = true;
        const N = {}; for (const [pin, h] of Object.entries(p.pins)) N[pin] = node(h);
        const pins = (TYPES[p.type] || { leads: Object.keys(p.pins) }).leads.map((k) => N[k]);   // in declared order
        const m = modelOf(p);
        switch (kindOf(p)) {
          case "resistor": els.push({ k: "R", a: pins[0], b: pins[1], r: p.value, id: p.id }); break;
          case "ammeter": els.push({ k: "R", a: N["+"], b: N["-"], r: METER_R, id: p.id, fuse: METER_FUSE }); break;
          case "led": {
            const c = LED_COLORS[p.color || "red"];
            // Shockley diode + series resistance rs, ideality n: Vf = c.vf at 10 mA
            const nvt = (m.n || 2) * VT, rs = m.rs || 10, is = 0.01 / Math.exp((c.vf - 0.01 * rs) / nvt);
            els.push({ k: "D", a: pins[0], b: pins[1], mid: internal(), rs, is, nvt, id: p.id, led: true }); break;
          }
          case "diode": els.push({ k: "D", a: pins[0], b: pins[1], mid: internal(), rs: m.rs, is: m.is, nvt: m.n * VT, id: p.id }); break;
          case "capacitor": els.push({ k: "C", a: pins[0], b: pins[1], c: p.value, id: p.id }); break;   // pins[0] is + when polarised
          case "button": els.push({ k: "SW", a: pins[0], b: pins[1], ron: m.ron || 0.05, id: p.id }); break;
          case "pot": els.push({ k: "POT", a: pins[0], w: pins[1], b: pins[2], r: p.value, id: p.id }); break;
          case "ne555": els.push({ k: "555", pin: N, lo: internal(), ctrlDiv: true, id: p.id }); break;
          case "comparator": els.push({ k: "CMP", pin: N, m, id: p.id }); break;
          case "tone": els.push({ k: "TONE", pin: N, m, id: p.id }); break;
          case "logicin": els.push({ k: "IN", pin: N, m, id: p.id }); break;
          case "wire": break;
        }
      }
      this.els = els;
      if (!this.fixedDt) this.dt = els.some((e) => e.k === "TONE") ? 1e-4 : 5e-4;
      this.n = n;
      this.index = index;
      this.gndNet = gnd;
      this.x = new Array(n).fill(0);
      this.vd = {};                            // last junction voltage per diode (Newton limiting)
      this.mode = "CV";
    }

    V(nodeIdx) { return nodeIdx < 0 ? 0 : this.x[nodeIdx]; }
    /** Voltage of any hole or terminal (relative to the supply's − terminal). */
    voltageAt(point) { const k = this.nets.netOf(point); if (k === this.gndNet) return 0; const i = this.index.get(k); return i === undefined ? 0 : this.x[i]; }

    _stamp(mode) {
      const n = this.n, A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
      const G = (a, c, g) => { if (a >= 0) A[a][a] += g; if (c >= 0) A[c][c] += g; if (a >= 0 && c >= 0) { A[a][c] -= g; A[c][a] -= g; } };
      const I = (a, c, i) => { if (a >= 0) b[a] -= i; if (c >= 0) b[c] += i; };      // current i flows a -> c through the element
      // a branch a -> c carrying g*(Va - Vc - e): conductance plus an EMF
      const branch = (a, c, g, e) => { G(a, c, g); I(a, c, -g * e); };
      for (let i = 0; i < n; i++) A[i][i] += GMIN;
      const S = this.supply;
      if (mode === "CV") branch(this.pNode, -1, 20, S.v);                             // 50 mOhm output
      else I(-1, this.pNode, S.ilim);                                                  // constant current out of +
      for (const e of this.els) {
        switch (e.k) {
          case "R": G(e.a, e.b, this.state.burnt[e.id] ? 1e-10 : 1 / e.r); break;       // a blown fuse is open
          case "SW": G(e.a, e.b, this.pressed[e.id] ? 1 / e.ron : 1e-10); break;
          case "POT": {
            const pos = Math.min(0.999, Math.max(0.001, this.potPos[e.id] ?? 0.5));
            G(e.a, e.w, 1 / (e.r * pos)); G(e.w, e.b, 1 / (e.r * (1 - pos))); break;
          }
          case "C": { const g = e.c / this.dt; branch(e.a, e.b, g, this.state.capV[e.id] || 0); break; }
          case "D": {
            if (this.state.burnt[e.id]) { G(e.a, e.b, 1e-10); break; }
            G(e.a, e.mid, 1 / e.rs);
            const vd = this.vd[e.id] ?? 0;
            const ex = Math.exp(Math.min(vd / e.nvt, 80));
            const id = e.is * (ex - 1), gd = e.is / e.nvt * ex + GMIN;
            G(e.mid, e.b, gd); I(e.mid, e.b, id - gd * vd); break;
          }
          case "CMP": {                                           // open-collector comparators: an output is off or pulls low
            const P = e.pin, M = e.m, st = this.state.cmp[e.id] || {};
            G(P[M.vcc], P[M.gnd], M.iq / Math.max(this.supply.v, 1));                     // quiescent draw
            for (const ch of M.channels) G(P[ch.out], P[M.gnd], st[ch.out] ? 1e-10 : 1 / M.ron);
            break;
          }
          case "TONE": {                                          // a mic breakout: offset + sine, behind its output resistance
            const P = e.pin, M = e.m, pwr = this.V(P[M.vdd]) - this.V(P[M.gnd]) > M.vmin;
            const amp = pwr ? M.levels[this.sound] ?? 0 : 0, off = pwr ? M.offset : 0;
            branch(P[M.out], P[M.gnd], 1 / M.rout, off + amp * Math.sin(2 * Math.PI * M.freq * this.t));
            G(P[M.vdd], P[M.gnd], M.iq / Math.max(this.supply.v, 1));
            break;
          }
          case "IN": G(e.pin[e.m.in], e.pin[e.m.gnd], 1 / e.m.rin); break;   // a GPIO input: high impedance
          case "555": {
            const P = e.pin, gnd = P["1"], vcc = P["8"];
            G(vcc, P["5"], 1 / 5000); G(P["5"], e.lo, 1 / 5000); G(e.lo, gnd, 1 / 5000);   // the 5k-5k-5k divider
            G(vcc, gnd, 1 / 1500);                                                          // quiescent draw
            if (this.state.q555[e.id]) branch(vcc, P["3"], 1 / 10, 1.7);                    // output high: VCC - 1.7 V
            else { G(P["3"], gnd, 1 / 10); G(P["7"], gnd, 1 / 20); }                        // output low, discharge on
            break;
          }
        }
      }
      return { A, b };
    }

    /** One time step: Newton to convergence, then commit capacitor/555/LED state. Returns false if singular. */
    step() {
      const S = this.supply;
      for (let pass = 0; pass < 3; pass++) {
        let ok = false;
        for (let it = 0; it < 60; it++) {
          const { A, b } = this._stamp(this.mode);
          const x = solveLinear(A, b);
          if (!x) return false;
          let maxDx = 0, limited = false;
          for (let i = 0; i < this.n; i++) maxDx = Math.max(maxDx, Math.abs(x[i] - this.x[i]));
          this.x = x;
          for (const e of this.els) {
            if (e.k !== "D" || this.state.burnt[e.id]) continue;
            const vnew = this.V(e.mid) - this.V(e.b), vold = this.vd[e.id] ?? 0;
            const vcrit = e.nvt * Math.log(e.nvt / (Math.SQRT2 * e.is));
            const vl = pnjlim(vnew, vold, e.nvt, vcrit);
            if (Math.abs(vl - vnew) > 1e-9) limited = true;
            this.vd[e.id] = vl;
          }
          if (maxDx < 1e-7 && !limited) { ok = true; break; }
        }
        if (!ok) { /* keep the last iterate; the next step continues from it */ }
        // supply mode: CV until the current limit, then CC until the voltage would exceed the setting
        const vout = this.V(this.pNode), iout = this.mode === "CV" ? 20 * (S.v - vout) : S.ilim;
        if (this.mode === "CV" && iout > S.ilim * 1.0001) { this.mode = "CC"; continue; }
        if (this.mode === "CC" && vout > S.v) { this.mode = "CV"; continue; }
        break;
      }
      this.t += this.dt;
      // commit state
      for (const e of this.els) {
        if (e.k === "C") {                                    // i = C dV/dt, from this step's change
          const v = this.V(e.a) - this.V(e.b);
          this.state.capI[e.id] = e.c * (v - (this.state.capV[e.id] || 0)) / this.dt;
          this.state.capV[e.id] = v;
        }
        if (e.fuse && !this.state.burnt[e.id]) {                 // the meter's fuse: over its rating for 5 ms, it goes
          const i = Math.abs(this.current(e.id));
          this.state.stress[e.id] = i > e.fuse ? (this.state.stress[e.id] || 0) + this.dt : 0;
          if (this.state.stress[e.id] > 0.005) { this.state.burnt[e.id] = true; this.burnedNow = (this.burnedNow || []).concat(e.id); }
        }
        if (e.k === "D" && e.led && !this.state.burnt[e.id]) {
          const i = this.current(e.id);
          this.state.stress[e.id] = i > LED_BURN ? (this.state.stress[e.id] || 0) + this.dt : 0;
          if (this.state.stress[e.id] > 0.02) { this.state.burnt[e.id] = true; this.burnedNow = (this.burnedNow || []).concat(e.id); }
        }
        if (e.k === "CMP") {                                     // decide each output for the next step, with a little hysteresis
          const P = e.pin, st = this.state.cmp[e.id] || (this.state.cmp[e.id] = {});
          const powered = this.V(P[e.m.vcc]) - this.V(P[e.m.gnd]) > e.m.vmin;
          for (const ch of e.m.channels) {
            const d = this.V(P[ch.inp]) - this.V(P[ch.inn]), h = e.m.hyst;
            st[ch.out] = powered && (st[ch.out] ? d > -h : d > h);   // true = output off (IN+ above IN-)
          }
        }
        if (e.k === "555") {
          const P = e.pin, v = (k) => this.V(P[k]), vg = v("1");
          const vcc = v("8") - vg;
          let q = !!this.state.q555[e.id];
          if (vcc < 3 || v("4") - vg < 0.7) q = false;
          else if (v("2") < this.V(e.lo)) q = true;                  // trigger below 1/3 VCC: set
          else if (v("6") > v("5")) q = false;                       // threshold above 2/3 VCC: reset
          this.state.q555[e.id] = q;
        }
      }
      return true;
    }

    run(seconds) { const n = Math.round(seconds / this.dt); for (let i = 0; i < n; i++) if (!this.step()) return false; return true; }

    /** Current through a 2-terminal part (A->K, 1->2, +->-), in amps. */
    current(id) {
      const e = this.els.find((x) => x.id === id);
      if (!e) return 0;
      switch (e.k) {
        case "R": return this.state.burnt[e.id] ? 0 : (this.V(e.a) - this.V(e.b)) / e.r;
        case "SW": return (this.V(e.a) - this.V(e.b)) * (this.pressed[e.id] ? 1 / e.ron : 1e-10);
        case "D": return this.state.burnt[e.id] ? 0 : (this.V(e.a) - this.V(e.mid)) / e.rs;
        case "C": return 0;
        default: return 0;
      }
    }
    supplyReading() {
      const v = this.V(this.pNode);
      return { v, i: this.mode === "CV" ? Math.max(0, 20 * (this.supply.v - v)) : this.supply.ilim, mode: this.mode };
    }
    reverseV(id) { const e = this.els.find((x) => x.id === id); return e ? this.V(e.b) - this.V(e.a) : 0; }
    /** What a meter would say about a part: current through it (first lead -> second) and voltage across it.
     *  Pots report each leg's voltage and the current in each half of the track; a 555, its output state. */
    reading(id) {
      const e = this.els.find((x) => x.id === id);
      if (!e) return null;
      switch (e.k) {
        case "R": case "SW": case "D": return { i: this.current(id), v: this.V(e.a) - this.V(e.b) };
        case "C": return { i: this.state.capI[id] || 0, v: this.V(e.a) - this.V(e.b) };
        case "POT": {
          const pos = Math.min(0.999, Math.max(0.001, this.potPos[id] ?? 0.5));
          const va = this.V(e.a), vw = this.V(e.w), vb = this.V(e.b);
          const iTop = (va - vw) / (e.r * pos), iBot = (vw - vb) / (e.r * (1 - pos));
          return { v1: va, vw, v3: vb, iTop, iBot, iW: iTop - iBot };
        }
        case "555": { const g = this.V(e.pin["1"]); return { q: !!this.state.q555[id], vcc: this.V(e.pin["8"]) - g, vout: this.V(e.pin["3"]) - g }; }
        case "CMP": { const P = e.pin, g = this.V(P[e.m.gnd]), st = this.state.cmp[id] || {};
          return { vcc: this.V(P[e.m.vcc]) - g, channels: e.m.channels.map((ch) => ({ ...ch, vp: this.V(P[ch.inp]) - g, vn: this.V(P[ch.inn]) - g, vout: this.V(P[ch.out]) - g, off: !!st[ch.out] })) }; }
        case "TONE": return { sound: this.sound, vout: this.V(e.pin[e.m.out]) - this.V(e.pin[e.m.gnd]) };
        case "IN": { const v = this.V(e.pin[e.m.in]) - this.V(e.pin[e.m.gnd]), vs = this.supply.v;
          return { v, level: v >= e.m.vih * vs ? "HIGH" : v <= e.m.vil * vs ? "LOW" : "undefined" }; }
      }
      return null;
    }
  }

  // ---------------------------------------------------------------- checking a build
  const clone = (parts) => parts.map((p) => ({ ...p, pins: { ...p.pins } }));

  function ledCurrents(sim, parts) { return parts.filter((p) => kindOf(p) === "led").map((p) => ({ id: p.id, i: sim.current(p.id) })); }

  /** Run a copy of the build for `seconds` and report. Never touches the player's parts. */
  const METER_R = 0.1, METER_FUSE = 0.2;                        // amps mode: a 0.1 ohm shunt behind a 200 mA fuse
  /** The meter as a circuit element, when it's in amps mode with both probes down and its fuse intact.
   *  In volts mode it draws nothing (an ideal voltmeter), so it isn't part of the circuit at all. */
  function meterPart(m) {
    return m && m.mode === "A" && !m.blown && m.probes && m.probes.length === 2
      ? { id: "METER", type: "ammeter", pins: { "+": m.probes[0], "-": m.probes[1] } } : null;
  }

  /** Run a copy of the build on a timeline. press(t) -> {buttonId: bool}. Samples every ~10 ms. */
  function script(parts, supply, seconds, press) {
    const sim = new Sim(clone(parts), supply);
    const every = Math.max(1, Math.round(0.01 / sim.dt)), samples = [];
    const n = Math.round(seconds / sim.dt);
    for (let k = 0; k < n; k++) {
      sim.pressed = press(sim.t);
      sim.step();
      if (k % every === 0) samples.push({ t: sim.t, leds: ledCurrents(sim, parts) });
    }
    return { sim, samples, burnt: Object.keys(sim.state.burnt).filter((id) => !parts.find((p) => p.id === id)?.burnt) };
  }
  /** Seconds after `from` until the LED's current first drops below `below` (null if it never does). */
  function darkAfter(samples, id, from, below = 0.001) {
    for (const s of samples) if (s.t >= from && s.leds.find((l) => l.id === id).i < below) return s.t - from;
    return null;
  }
  const ledAt = (samples, id, t) => { let best = samples[0]; for (const s of samples) if (s.t <= t) best = s; return best.leds.find((l) => l.id === id).i; };

  function trial(parts, supply, { seconds = 0.25, pressed = {}, pots = {}, sample } = {}) {
    const sim = new Sim(clone(parts), supply);
    sim.pressed = pressed; sim.potPos = pots;
    const samples = [];
    const n = Math.round(seconds / sim.dt);
    for (let k = 0; k < n; k++) { sim.step(); if (sample && k % sample === 0) samples.push({ t: sim.t, leds: ledCurrents(sim, parts) }); }
    return { sim, leds: ledCurrents(sim, parts), burnt: Object.keys(sim.state.burnt).filter((id) => !parts.find((p) => p.id === id)?.burnt), supply: sim.supplyReading(), samples };
  }

  /**
   * Is the level solved? goal kinds:
   *   lit    {count, min, max}          at least `count` LEDs, every placed LED within [min, max] amps
   *   button {min, max}                 LEDs dark with the button up, lit (within range) while it's held
   *   dimmer {ratio, max}               turning the pot end to end changes the LED current by `ratio`, never above max
   *   blink  {fmin, fmax, seconds}      an LED flashes at fmin..fmax Hz
   *   divider {target, tol, span}       a pot wired as a divider (the knob sweeps its wiper across >= span of the
   *                                     supply) whose knob, as the player left it, puts the wiper at target +- tol
   * state: {pots} -- the knob positions as the player left them.
   * Returns {ok, why} where `why` explains a failure in terms of what the circuit did.
   */
  // ---------------------------------------------------------------- wired like the schematic?
  /**
   * Compare a build's connections with a circuit level's netlist (level.nets: {name: ["R1.2", "PSU.+", ...]}).
   * Placed parts carry their designators (the bin names them), but two identical parts may trade roles, and a
   * part with no polarity may sit either way round (a pot's two ends too). Pins the netlist doesn't mention
   * must connect to nothing it does. Returns the best reading: {ok, missing, splits, merges, extras, pinHole}.
   */
  function matchNetlist(parts, level) {
    const specs = Object.fromEntries(level.bin.filter((b) => b.ref).map((b) => [b.ref, b]));
    const refs = Object.keys(specs);
    const placed = Object.fromEntries(parts.filter((p) => specs[p.id]).map((p) => [p.id, p]));
    const missing = refs.filter((r) => !placed[r]);
    if (missing.length) return { ok: false, missing, splits: [], merges: [], extras: [] };
    const nets = buildNets(parts);
    // identical parts (same type, value, colour) may trade places
    const groups = {};
    for (const r of refs) { const b = specs[r], k = [b.type, b.value, b.color].join("|"); (groups[k] = groups[k] || []).push(r); }
    const perms = (xs) => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]));
    let assigns = [{}];
    for (const g of Object.values(groups)) assigns = assigns.flatMap((a) => perms(g).map((pm) => ({ ...a, ...Object.fromEntries(g.map((r, i) => [r, pm[i]])) })));
    // parts with no polarity may be turned round: which pins swap
    const swapOf = (ref) => {
      const d = LIB[specs[ref].type], k = d.model.kind, ids = d.pins.map((x) => x.id);
      if (k === "pot") return [ids[0], ids[2]];
      if (d.footprint.kind === "two-lead" && (k === "resistor" || k === "button" || (k === "capacitor" && !d.model.polarised))) return [ids[0], ids[1]];
      return null;
    };
    const swappable = refs.filter(swapOf);
    const mentioned = new Set(Object.values(level.nets).flat());
    const evaluate = (assign, flips) => {
      const pinHole = (pin) => {
        const [ref, id] = pin.split(/\.(.+)/);
        if (ref === "PSU") return "PSU." + id;
        const part = placed[assign[ref]], sw = swapOf(ref);
        const real = sw && flips.has(ref) ? (id === sw[0] ? sw[1] : id === sw[1] ? sw[0] : id) : id;
        return part.pins[real];
      };
      const splits = [], owner = new Map(), merges = [], extras = [];
      for (const [name, pins] of Object.entries(level.nets)) {
        const byNet = new Map();
        for (const pin of pins) { const k = nets.netOf(pinHole(pin)); if (!byNet.has(k)) byNet.set(k, []); byNet.get(k).push(pin); }
        if (byNet.size > 1) splits.push({ net: name, groups: [...byNet.values()].sort((x, y) => y.length - x.length) });
        for (const k of byNet.keys()) { if (!owner.has(k)) owner.set(k, []); owner.get(k).push(name); }
      }
      for (const [k, names] of owner) if (names.length > 1) merges.push({ nets: [...new Set(names)], strips: nets.stripsIn(k) });
      for (const r of refs) for (const d of LIB[specs[r].type].pins) {
        const pin = `${r}.${d.id}`;
        if (mentioned.has(pin)) continue;
        const k = nets.netOf(pinHole(pin)), with_ = owner.get(k);
        if (with_) extras.push({ pin, net: with_[0] });
      }
      const score = -(splits.length * 2 + merges.length * 2 + extras.length);
      return { ok: score === 0, missing: [], splits, merges, extras, pinHole, assign, score };
    };
    let best = null;
    const tryAll = (assign) => {
      if (swappable.length <= 12) {
        for (let mask = 0; mask < 1 << swappable.length; mask++) {
          const r = evaluate(assign, new Set(swappable.filter((_, i) => mask & (1 << i))));
          if (!best || r.score > best.score) best = r;
          if (r.ok) return true;
        }
      } else {                                                   // large: flip one part at a time while it helps
        let flips = new Set(), cur = evaluate(assign, flips);
        for (let pass = 0; pass < 2; pass++) for (const r of swappable) {
          const t = new Set(flips); t.has(r) ? t.delete(r) : t.add(r);
          const e = evaluate(assign, t); if (e.score > cur.score) { cur = e; flips = t; }
        }
        if (!best || cur.score > best.score) best = cur;
        if (cur.ok) return true;
      }
      return false;
    };
    for (const a of assigns.slice(0, 720)) if (tryAll(a)) break;
    return best;
  }
  function checkGoal(parts, level, state = {}) {
    const g = level.goal, S = level.supply;
    if (g.kind === "all") {                                      // every condition, in order; the first failure speaks
      const whys = [];
      for (const sub of g.of) { const r = checkGoal(parts, { ...level, goal: sub }, state); if (!r.ok) return r; whys.push(r.why); }
      return { ok: true, why: whys.join(" ") };
    }
    if (g.kind === "netlist") {
      const m = matchNetlist(parts, level);
      if (m.ok) return { ok: true, why: "Every net is wired the way the schematic says." };
      if (m.missing.length) return { ok: false, why: `${m.missing.join(", ")} ${m.missing.length > 1 ? "aren't" : "isn't"} on the board yet.` };
      if (m.merges.length) return { ok: false, why: `Nets ${m.merges[0].nets.join(" and ")} are joined on your board; the schematic keeps them apart.` };
      if (m.splits.length) return { ok: false, why: `Net ${m.splits[0].net} isn't all connected yet: ${m.splits.length} net${m.splits.length > 1 ? "s" : ""} still ${m.splits.length > 1 ? "have" : "has"} a gap.` };
      return { ok: false, why: `${m.extras[0].pin} is connected to net ${m.extras[0].net}, but the schematic leaves it unconnected.` };
    }
    const leds = parts.filter((p) => kindOf(p) === "led");
    const mA = (i) => (i * 1000).toFixed(1) + " mA";
    if (leds.some((p) => p.burnt)) return { ok: false, why: "A burnt-out LED is still on the board. Pull it (it goes in the bin) and use a fresh one." };
    const need = g.count ?? (g.kind === "listen" ? 0 : 1);    // goals about light need an LED; listening doesn't
    if (leds.length < need) return { ok: false, why: `This level needs ${need} LED${need > 1 ? "s" : ""} on the board.` };
    const inRange = (r) => r.leds.every((l) => l.i >= g.min && l.i <= g.max);
    const dark = (r) => r.leds.every((l) => l.i < 0.0005);
    if (g.kind === "lit") {
      const r = trial(parts, S);
      if (r.burnt.length) return { ok: false, why: `${r.burnt.join(", ")} burned out as soon as the power came on.` };
      const bad = r.leds.find((l) => l.i < g.min || l.i > g.max);
      if (bad) return { ok: false, why: bad.i < 0.0005 ? `${bad.id} stays dark.` : `${bad.id} carries ${mA(bad.i)}; this level wants ${mA(g.min)}–${mA(g.max)}.` };
      return { ok: true, why: r.leds.map((l) => `${l.id}: ${mA(l.i)}`).join(", ") };
    }
    if (g.kind === "button") {
      const btn = parts.filter((p) => kindOf(p) === "button");
      if (!btn.length) return { ok: false, why: "There's no button on the board yet." };
      const up = trial(parts, S), down = trial(parts, S, { pressed: Object.fromEntries(btn.map((b) => [b.id, true])) });
      if (down.burnt.length) return { ok: false, why: `${down.burnt.join(", ")} burned out when the button was pressed.` };
      if (!dark(up)) return { ok: false, why: "The LED is lit even with the button up. The button has to be the only path for the current." };
      if (!inRange(down)) return { ok: false, why: down.leds.every((l) => l.i < 0.0005) ? "Pressing the button doesn't light the LED." : `Pressed, the LED carries ${mA(down.leds[0].i)}; this level wants ${mA(g.min)}–${mA(g.max)}.` };
      return { ok: true, why: `Up: dark. Pressed: ${down.leds.map((l) => mA(l.i)).join(", ")}.` };
    }
    if (g.kind === "dimmer") {
      const pots = parts.filter((p) => kindOf(p) === "pot");
      if (!pots.length) return { ok: false, why: "There's no potentiometer on the board yet." };
      const at = (pos) => trial(parts, S, { pots: Object.fromEntries(pots.map((p) => [p.id, pos])) });
      const lo = at(0.001), hi = at(0.999);
      for (const r of [lo, hi]) if (r.burnt.length) return { ok: false, why: `Turned all the way, ${r.burnt.join(", ")} burns out: at that end the pot is 0 Ω and nothing else limits the current. A fixed resistor in series keeps a floor under it.` };
      const a = lo.leds[0].i, b = hi.leds[0].i, big = Math.max(a, b), small = Math.min(a, b);
      if (big > g.max) return { ok: false, why: `At one end the LED carries ${mA(big)}; keep it under ${mA(g.max)}.` };
      if (big < 0.002) return { ok: false, why: "The LED stays dark at both ends of the knob." };
      if (big < g.ratio * Math.max(small, 1e-6)) return { ok: false, why: `The knob only changes the LED from ${mA(small)} to ${mA(big)}. The pot needs to be in the LED's path, and wired as a variable resistor (middle leg + one end).` };
      return { ok: true, why: `The knob sweeps the LED from ${mA(small)} to ${mA(big)}.` };
    }
    if (g.kind === "afterglow") {
      // hold every button for `hold` s, release, and time the glow
      const btn = parts.filter((p) => kindOf(p) === "button");
      if (!btn.length) return { ok: false, why: "There's no button on the board yet." };
      const id = leds[0].id, all = Object.fromEntries(btn.map((b) => [b.id, true]));
      const r = script(parts, S, g.hold + g.maxGlow + 1, (t) => (t < g.hold ? all : {}));
      if (r.burnt.length) return { ok: false, why: `${r.burnt.join(", ")} burned out.` };
      const held = ledAt(r.samples, id, g.hold - 0.01);
      if (held < g.min) return { ok: false, why: held < 0.0005 ? `${id} doesn't light while the button is held.` : `Held, ${id} carries ${mA(held)}; it needs at least ${mA(g.min)}.` };
      if (held > g.max) return { ok: false, why: `Held, ${id} carries ${mA(held)}; keep it under ${mA(g.max)}.` };
      const glow = darkAfter(r.samples, id, g.hold, held * 0.2);      // until it fades to a fifth of its held brightness
      if (glow === null) return { ok: false, why: `${id} never goes out after you let go: something other than the capacitor is still feeding it.` };
      if (glow < 0.05) return { ok: false, why: `${id} goes dark the instant you let go: nothing is storing charge for it. The capacitor goes between the LED's feed and ground, + leg on the feed.` };
      if (glow < g.minGlow) return { ok: false, why: `${id} fades out ${glow.toFixed(2)} s after you let go; this level wants ${g.minGlow}–${g.maxGlow} s. Longer glow: a bigger capacitor, or a bigger resistor (R × C).` };
      if (glow > g.maxGlow) return { ok: false, why: `${id} fades out ${glow.toFixed(2)} s after you let go; this level wants ${g.minGlow}–${g.maxGlow} s. Shorter: a smaller capacitor or resistor.` };
      return { ok: true, why: `Held: ${mA(held)}. Let go: ${id} glows on the capacitor's charge, fading to a fifth of that in ${glow.toFixed(2)} s.` };
    }
    if (g.kind === "latch") {
      // find a button that turns the LED on and leaves it on, and another that turns it off and leaves it off
      const btn = parts.filter((p) => kindOf(p) === "button");
      if (btn.length < 2) return { ok: false, why: `This needs two buttons, one to set and one to reset. ${btn.length ? "There's only one." : "There are none yet."}` };
      const id = leds[0].id;
      const r0 = script(parts, S, 0.2, () => ({}));
      if (ledAt(r0.samples, id, 0.19) > 0.001) return { ok: false, why: `${id} is already lit before any button is pressed. The chip should wait for a press on pin 2 (TRIGGER).` };
      let set = null;
      for (const b of btn) {
        const r = script(parts, S, 0.6, (t) => (t > 0.1 && t < 0.2 ? { [b.id]: true } : {}));
        if (ledAt(r.samples, id, 0.18) > g.min && ledAt(r.samples, id, 0.58) > g.min) { set = b; break; }
      }
      if (!set) return { ok: false, why: `No button turns ${id} on and leaves it on. The set button pulls pin 2 (TRIGGER) to ground; a pull-up resistor holds pin 2 high the rest of the time.` };
      for (const b of btn) {
        if (b === set) continue;
        const r = script(parts, S, 1.0, (t) => (t > 0.1 && t < 0.2 ? { [set.id]: true } : t > 0.5 && t < 0.6 ? { [b.id]: true } : {}));
        if (ledAt(r.samples, id, 0.45) > g.min && ledAt(r.samples, id, 0.58) < 0.0005 && ledAt(r.samples, id, 0.98) < 0.0005)
          return { ok: true, why: `${set.id} sets it: ${id} lights and stays lit after you let go. ${b.id} resets it: dark, and it stays dark.` };
      }
      return { ok: false, why: `${set.id} turns ${id} on and it stays on, but no other button turns it off. The reset button pulls pin 4 (RESET) to ground, with its own pull-up holding pin 4 high the rest of the time.` };
    }
    if (g.kind === "oneshot") {
      const btn = parts.filter((p) => kindOf(p) === "button");
      if (!btn.length) return { ok: false, why: "There's no button on the board yet." };
      const id = leds[0].id, b = btn[0];
      const r = script(parts, S, 0.3 + g.maxPulse + 1, (t) => (t > 0.2 && t < 0.25 ? { [b.id]: true } : {}));
      if (ledAt(r.samples, id, 0.19) > 0.001) return { ok: false, why: `${id} is lit before the button is pressed. It should wait for a press on pin 2.` };
      if (ledAt(r.samples, id, 0.24) < g.min) return { ok: false, why: `A press doesn't light ${id}. The button pulls pin 2 (TRIGGER) low; a pull-up holds it high otherwise.` };
      if (ledAt(r.samples, id, 0.3) < g.min) return { ok: false, why: `${id} lights only while the button is held, and goes out the instant you let go: nothing makes the chip wait. The timing capacitor (from pins 6 and 7 to ground) is what holds the output on while it fills through R1.` };
      const off = darkAfter(r.samples, id, 0.26);              // time from just after the press until it goes dark
      const on = off === null ? null : off + 0.06;
      if (on === null) return { ok: false, why: `${id} lights and never goes out. The timing capacitor has to reach pin 6 (THRESHOLD): pins 6 and 7 joined, the capacitor from them to ground, the timing resistor from + to them.` };
      if (on < g.minPulse || on > g.maxPulse) return { ok: false, why: `One press lights ${id} for ${on.toFixed(2)} s; this level wants ${g.minPulse}–${g.maxPulse} s (about 1.1 × R × C).` };
      return { ok: true, why: `One press, ${on.toFixed(2)} s of light: 1.1 × R × C, timed by the capacitor reaching ⅔ of the supply.` };
    }
    if (g.kind === "listen") {
      const pin = parts.find((p) => kindOf(p) === "logicin"), mic = parts.find((p) => kindOf(p) === "tone");
      if (!pin || !mic) return { ok: false, why: `This needs ${!mic ? "a tone source" : "the ESP32 input pin"} on the board.` };
      const sim = new Sim(clone(parts), S, { dt: 1e-3 });
      sim.potPos = state.pots || {};
      sim.sound = "off";
      sim.run(g.settle ?? 3);                                     // let the capacitors settle, quietly
      sim.dt = 1e-4; sim.sound = g.sound;
      const n = Math.round((g.listen ?? 1) / sim.dt), levels = [];
      for (let k = 0; k < n; k++) { sim.step(); if (k > n / 2 && k % 50 === 0) levels.push(sim.reading(pin.id).level); }
      const r = sim.reading(pin.id), cmp = parts.find((p) => kindOf(p) === "comparator");
      const why = cmp ? (() => { const c = sim.reading(cmp.id).channels[0]; return ` (${cmp.id}'s + input sits at ${c.vp.toFixed(2)} V, its − input at ${c.vn.toFixed(2)} V)`; })() : "";
      const want = g.expect.toUpperCase(), steady = levels.every((l) => l === want);
      if (!steady) return { ok: false, why: `With a ${g.sound}-level sound, ${pin.id} should read ${want} but reads ${r.level} (${r.v.toFixed(2)} V)${why}.` };
      return { ok: true, why: `${g.sound[0].toUpperCase() + g.sound.slice(1)}: ${pin.id} reads ${want}${why}.` };
    }
    if (g.kind === "ammeter") {
      const m = state.meter || {};
      if (m.mode !== "A") return { ok: false, why: "The meter is set to volts. Switch it to A (amps) in the meter panel." };
      if (m.blown) return { ok: false, why: "The meter's fuse is blown. Replace it in the meter panel, and this time put the meter in the loop, not across anything." };
      if (!m.probes || m.probes.length < 2) return { ok: false, why: "Put both probes on the board: red first, then black." };
      const all = [...parts, meterPart(m)], nets = buildNets(all);
      if (nets.netOf(m.probes[0]) === nets.netOf(m.probes[1])) return { ok: false, why: "The meter reads 0: both probes are on the same conductor, so the current takes the wire and nothing goes through the meter. Pull the wire that closes the loop, so the only way round is through the meter." };
      const r = trial(all, S), led = r.leds[0];
      if (r.burnt.includes("METER")) return { ok: false, why: "The meter's fuse blew: its probes put a near-short (0.1 Ω) straight across the supply. In amps mode the meter goes in the gap, in series, never across." };
      const im = r.sim.current("METER");
      if (led.i < 0.0005) return { ok: false, why: Math.abs(im) > 0.001
        ? `The meter reads ${mA(Math.abs(im))}, but ${led.id} is dark: the meter is in parallel with it. At 0.1 Ω it's a far easier path than the LED, so the current goes around ${led.id}, through the meter. Break the loop and put the meter in the gap instead.`
        : `${led.id} is dark and nothing flows through the meter: the loop is still open. The probes should bridge the gap you made.` };
      if (Math.abs(Math.abs(im) - led.i) > 0.05 * led.i) return { ok: false, why: `The meter reads ${mA(Math.abs(im))} but ${led.id} carries ${mA(led.i)}: the meter isn't in the LED's loop.` };
      if (im < 0) return { ok: true, why: `The meter reads −${mA(-im)}: the right current, with the probes swapped. Red goes where the current comes from, black where it goes.` };
      return { ok: true, why: `The meter reads ${mA(im)} and ${led.id} carries ${mA(led.i)}: the same current, because they're in the same loop.` };
    }
    if (g.kind === "divider") {
      const pots = parts.filter((p) => kindOf(p) === "pot");
      if (!pots.length) return { ok: false, why: "There's no potentiometer on the board yet." };
      const p = pots[0];
      const at = (pos) => { const r = trial(parts, S, { seconds: 0.02, pots: { [p.id]: pos } }); return { v: r.sim.voltageAt(p.pins.W), cc: r.supply.mode === "CC" }; };
      const a = at(0.001), b = at(0.999), lo = Math.min(a.v, b.v), hi = Math.max(a.v, b.v), V = (v) => v.toFixed(2) + " V";
      if (a.cc || b.cc) return { ok: false, why: `At one end of the knob, ${p.id} shorts + to − and the supply hits its current limit. The middle leg (wiper) is on a rail: the ends go to the rails, and the wiper is the output.` };
      if (hi - lo < 0.05) return { ok: false, why: `Turning ${p.id} doesn't change the wiper's voltage: it stays at ${V(lo)}. A divider needs both end legs connected, one to + and one to −, so the wiper has something to divide.` };
      if (hi - lo < g.span * S.v) return { ok: false, why: `Turning ${p.id} only moves the wiper between ${V(lo)} and ${V(hi)}. Put the end legs straight on the rails and it covers 0 to ${S.v} V.` };
      const now = at(state.pots?.[p.id] ?? 0.5).v;
      if (Math.abs(now - g.target) > g.tol) return { ok: false, why: `It's a working divider: the knob sweeps the wiper from ${V(lo)} to ${V(hi)}. Right now it sits at ${V(now)}. Turn ${p.id} until the meter reads ${g.target} V (±${g.tol}).` };
      return { ok: true, why: `${p.id}'s wiper sits at ${V(now)}, and the knob sweeps it from ${V(lo)} to ${V(hi)}.` };
    }
    if (g.kind === "blink") {
      const r = trial(parts, S, { seconds: g.seconds, sample: 20 });
      if (r.burnt.length) return { ok: false, why: `${r.burnt.join(", ")} burned out.` };
      const id = leds[0].id;
      let on = null, edges = [];
      for (const s of r.samples) {
        const i = s.leds.find((l) => l.id === id).i;
        const now = on ? i > 0.001 : i > 0.002;
        if (on !== null && now && !on) edges.push(s.t);
        on = now;
      }
      if (edges.length < 2) return { ok: false, why: on ? `${id} lights but never goes out.` : `${id} never flashes.` };
      const f = (edges.length - 1) / (edges[edges.length - 1] - edges[0]);
      if (f < g.fmin || f > g.fmax) return { ok: false, why: `${id} flashes at ${f.toFixed(2)} Hz; this level wants ${g.fmin}–${g.fmax} Hz.` };
      return { ok: true, why: `${id} flashes at ${f.toFixed(2)} Hz.` };
    }
    return { ok: false, why: "Unknown goal." };
  }

  /**
   * What's wrong, most fundamental first. Each hint: {text: [nudge, specific, fix], holes: [...]}.
   * Built from the board's rules and one powered trial, so it describes what the build actually does.
   */
  function diagnose(parts, level) {
    const hints = [];
    const nets = buildNets(parts);
    const netOf = (h) => nets.netOf(h);
    const P = netOf("PSU.+"), N = netOf("PSU.-");
    const pinsOnNet = new Map();                 // net -> [{part, pin}]
    for (const p of parts) for (const [pin, h] of Object.entries(p.pins)) {
      const k = netOf(h); if (!pinsOnNet.has(k)) pinsOnNet.set(k, []); pinsOnNet.get(k).push({ p, pin, h });
    }
    const nonWire = (k) => (pinsOnNet.get(k) || []).filter((x) => kindOf(x.p) !== "wire");
    const leadsOn = (k) => (pinsOnNet.get(k) || []);
    const add = (text, holes = []) => hints.push({ text, holes });

    // 1. the supply
    const plusUsed = parts.some((p) => kindOf(p) === "wire" && Object.values(p.pins).includes("PSU.+"));
    const minusUsed = parts.some((p) => kindOf(p) === "wire" && Object.values(p.pins).includes("PSU.-"));
    if (!plusUsed || !minusUsed) {
      add(["Nothing on the board is getting power yet.",
        `The supply's ${!plusUsed ? "red (+)" : "black (−)"} terminal has no wire on it.`,
        "Wire the red terminal to a red + rail, and the black terminal to a blue − rail. Everything else takes its power from the rails."],
      [!plusUsed ? "PSU.+" : "PSU.-"]);
      return hints;
    }
    if (P === N) {
      add(["The supply's + and − are joined together: a dead short.",
        "Follow the red and black wires: somewhere + and − land in the same strip or rail.",
        "Move one of the supply wires so + and − end up on different rails."], ["PSU.+", "PSU.-"]);
      return hints;
    }

    // 1b. a circuit level: compare with the schematic's netlist, net by net
    if (level.nets) {
      const m = matchNetlist(parts, level);
      const byRef = (pin) => { const [ref, id] = pin.split(/\.(.+)/); if (ref === "PSU") return id === "+" ? "the supply's + terminal" : "the supply's − terminal";
        const part = parts.find((q) => q.id === (m.assign ? m.assign[ref] : ref)) || { type: (level.bin.find((b) => b.ref === ref) || {}).type };
        return `${ref} ${pinName(part, id)}`; };
      const holes = (pins) => pins.map((p) => m.pinHole && m.pinHole(p)).filter(Boolean);
      const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
      for (const r of m.missing || []) add([`${r} isn't on the board yet.`, `The schematic has ${r}; pick it from the parts bin (it's labelled ${r}).`, `Place ${r}, then wire its nets.`]);
      for (const sp of m.splits || []) {
        const [main, ...rest] = sp.groups, lonely = rest.flat();
        add([`Net ${sp.net} isn't all connected.`,
          `${sp.net} should join ${level.nets[sp.net].map(byRef).join(", ")}. ${cap(lonely.map(byRef).join(" and "))} ${lonely.length > 1 ? "aren't" : "isn't"} connected to ${main.map(byRef).join(", ")}.`,
          `Add a wire from ${describeStrip(stripOf(m.pinHole(lonely[0])))} to ${describeStrip(stripOf(m.pinHole(main[0])))}, or move a leg into the same strip.`],
        holes([...lonely, main[0]]));
      }
      for (const mg of m.merges || []) {
        const pins = mg.nets.flatMap((n) => level.nets[n]);
        add([`Nets ${mg.nets.join(" and ")} are joined, but the schematic keeps them apart.`,
          `On your board they meet in ${mg.strips.slice(0, 2).map(describeStrip).join(" and ")}${mg.strips.length > 2 ? " (and more)" : ""}. Everything in one net ends up connected to everything in the other.`,
          `Find the wire or the leg that bridges them and move it: each net needs its own strip(s).`], holes(pins).slice(0, 6));
      }
      for (const ex of m.extras || []) add([`${ex.pin.split(".")[0]} has a leg connected that should be left free.`,
        `${byRef(ex.pin)} is joined to net ${ex.net}, but the schematic doesn't connect it to anything.`, `Leave ${byRef(ex.pin)} in a strip of its own.`], holes([ex.pin]));
      if (hints.length) return hints;
    }

    // 2. parts that do nothing: both legs in one strip
    for (const p of parts) {
      if (kindOf(p) === "wire") continue;
      const ks = Object.values(p.pins).map(netOf);
      if (ks.length === 2 && ks[0] === ks[1]) {
        const strip = describeStrip(stripOf(Object.values(p.pins)[0]));
        add([`${p.id} isn't doing anything.`,
          `Both of ${p.id}'s legs are in the same strip (${strip}). Everything in a strip is one conductor, so current goes around ${p.id}, not through it.`,
          `Turn ${p.id} so its legs land in two different strips: across columns, or across the centre channel.`], Object.values(p.pins));
      }
    }

    // 3. legs with nothing else in their strip
    // a pot as a variable resistor needs its wiper and may leave an end free; as a divider the ends are
    // required and the wiper is the output, measured, so it may sit alone in its strip
    const divider = level.goal && level.goal.kind === "divider";
    const optional = (p, pin) => !!pinDef(p, pin).optional || (kindOf(p) === "pot" && (divider ? pin === "W" : pin !== "W"));
    for (const p of parts) {
      if (kindOf(p) === "wire") continue;
      for (const [pin, h] of Object.entries(p.pins)) {
        const k = netOf(h);
        if (k === P || k === N) continue;
        const others = leadsOn(k).filter((x) => !(x.p === p && x.pin === pin));
        if (others.length === 0 && !optional(p, pin)) {
          add([`${p.id} has a leg that isn't connected to anything.`,
            `${p.id}'s ${pinName(p, pin)} is in ${describeStrip(stripOf(h))}, and nothing else is in that strip.`,
            `Add a wire from ${describeStrip(stripOf(h))} to where that leg belongs in the schematic, or move the next part's leg into the same strip.`], [h]);
        }
      }
      if (kindOf(p) === "pot") {
        const ends = ["1", "3"].filter((pin) => leadsOn(netOf(p.pins[pin])).length > 1);
        if (!ends.length) add([`${p.id} is only connected by its middle leg.`, `Neither end of ${p.id} connects to anything, so it can't vary anything.`, "Wire one end leg into the circuit as well: the middle leg and one end make a variable resistor."], [p.pins["1"], p.pins["3"]]);
      }
    }

    // 4. rails with things on them but no connection to the supply
    for (const r of RAILS) {
      const k = netOf(r + "3");
      const used = parts.some((p) => Object.values(p.pins).some((h) => parseHole(h)?.row === r));
      if (!used || k === P || k === N) continue;
      const touches = nonWire(k).length > 0;
      const other = r[0] === "T" ? "B" + r[1] : "T" + r[1];
      const otherLive = netOf(other + "3") === (r[1] === "+" ? P : N);
      if (touches) add([`Something is plugged into a rail that has no power.`,
        `${describeStrip("rail:" + r)} isn't connected to the supply${otherLive ? `, but ${describeStrip("rail:" + other)} is. The top and bottom rails are separate strips` : ""}.`,
        otherLive ? `Bridge them: a wire from ${describeStrip("rail:" + other)} to ${describeStrip("rail:" + r)} (usually at one end of the board).` : `Run a wire from the supply's ${r[1] === "+" ? "red (+)" : "black (−)"} terminal to ${describeStrip("rail:" + r)}.`],
      [r + "3", other + "3"]);
    }

    // 5. a powered trial: shorts, polarity, burn-outs, 555 wiring, an open loop
    // buttons held: judge the circuit in the state it's meant to work in
    // (except a button on a 555's RESET: holding that one is supposed to switch the chip off)
    const resetNets = new Set(parts.filter((q) => kindOf(q) === "ne555").map((q) => netOf(q.pins["4"])));
    const held = Object.fromEntries(parts.filter((q) => kindOf(q) === "button" && !Object.values(q.pins).some((h) => resetNets.has(netOf(h)))).map((q) => [q.id, true]));
    const r = trial(parts, level.supply, { seconds: 0.1, pressed: held });
    const sim = r.sim;
    if (r.supply.mode === "CC" && r.supply.v < 0.5) {
      add(["The supply hit its current limit and its voltage collapsed: there's a short.",
        "Something connects + to − with almost no resistance: a wire, or a part whose legs sit in the + and − strips directly.",
        "Look for anything plugged straight between a red rail and a blue rail with no resistor in the way."], ["PSU.+", "PSU.-"]);
    }
    for (const p of parts.filter((q) => kindOf(q) === "led")) {
      if (p.burnt) { add([`${p.id} is burnt out.`, `${p.id} took too much current and died. It stays dead: pull it off the board (it goes in the bin) and use a fresh one.`, "Every LED needs a resistor in series to set its current. Check the schematic for the value."], Object.values(p.pins)); continue; }
      if (r.burnt.includes(p.id)) add([`${p.id} burns out the moment the power comes on.`, `Nothing limits the current through ${p.id}: it would take ${(sim.current(p.id) * 1000).toFixed(0)} mA or more (its limit is ${LED_MAX * 1000} mA).`, "Put a resistor in series with the LED, between it and one of the rails."], Object.values(p.pins));
      else if (sim.reverseV(p.id) > 1) add([`${p.id} is in the circuit but dark.`, `${p.id} is backwards: current only flows from the long leg (anode, +) to the short leg (cathode, −). Right now the + side is on its short leg.`, `Flip ${p.id}: long leg toward +, short leg toward −.`], Object.values(p.pins));
    }
    for (const p of parts.filter((q) => polarised(q))) {
      const [pl, mi] = TYPES[p.type].leads;                     // a polarised part declares its + pin first
      const vp = sim.voltageAt(p.pins[pl]), vm = sim.voltageAt(p.pins[mi]);
      if (vm - vp > 0.5) add([`${p.id} is in backwards.`, `${p.id} is polarised: its + leg must sit on the more positive side. Right now it's reversed by ${(vm - vp).toFixed(1)} V.`, `Flip ${p.id}: the striped (−) side toward ground.`], Object.values(p.pins));
    }
    for (const p of parts.filter((q) => kindOf(q) === "ne555")) {
      for (const [pin, what] of [["2", "TRIGGER"], ["4", "RESET"]]) {       // a button to ground with nothing holding the pin high
        const k = netOf(p.pins[pin]), on = leadsOn(k);
        const hasButton = on.some((x) => kindOf(x.p) === "button"), hasPull = on.some((x) => kindOf(x.p) === "resistor") || k === P;
        if (hasButton && !hasPull) add([`${p.id}'s pin ${pin} (${what}) floats while the button is up.`,
          `A button can pull pin ${pin} low, but when it's released nothing holds the pin high, so it floats and the chip reads garbage.`,
          `Add a pull-up: a 10 kΩ resistor from pin ${pin}'s strip to +. It holds the pin high, and the button still wins when pressed.`], [p.pins[pin]]);
      }
      const v = (pin) => sim.voltageAt(p.pins[pin]);
      const vcc = v("8") - v("1");
      if (vcc < 4) add([`${p.id} isn't powered.`, `${p.id} sees ${vcc.toFixed(1)} V between pin 8 (VCC) and pin 1 (GND).`, "Pin 8 goes to +, pin 1 goes to −. Pin 1 is bottom-left, next to the notch; pin 8 is straight across from it."], [p.pins["8"], p.pins["1"]]);
      else if (v("4") - v("1") < 2) add([`${p.id} is held in reset.`, `Pin 4 is RESET: while it's low the chip does nothing. It's at ${(v("4") - v("1")).toFixed(1)} V.`, "Tie pin 4 to +."], [p.pins["4"]]);
      else if (level.goal && level.goal.kind === "blink" && netOf(p.pins["2"]) !== netOf(p.pins["6"])) add([`${p.id}'s timing isn't wired up.`, "In this circuit pins 2 (TRIG) and 6 (THR) both watch the capacitor's voltage, so they must be connected together.", "Wire pin 2 to pin 6, and make sure the capacitor's + leg is on that same strip."], [p.pins["2"], p.pins["6"]]);
    }
    if (!hints.length && r.supply.i < 1e-4) {
      add(["No current flows: the loop isn't complete.",
        "Current has to leave the red terminal, go through every part in turn, and come back to the black terminal. Somewhere there's a gap.",
        "Use the meter on continuity: probe from each part's leg to the next part's leg along the schematic. The one that doesn't beep is the gap."], []);
    }
    return hints;
  }

  const api = { COLS, ROWS_TOP, ROWS_BOT, RAILS, ROW_Y, railHas, parseHole, isHole, isTerminal, stripOf, describeStrip,
    allHoles, span, TYPES, LIB, LED_COLORS, LED_MAX, pinName, pinDef, kindOf, footprint, buildNets, Sim, trial, checkGoal, diagnose, clone,
    meterPart, METER_R, METER_FUSE, script, matchNetlist };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BenchEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
