/* Strip & Rail: KiCad netlists (.net, "Export Netlist" in Eeschema, KiCad 5 or 6+) -> circuit files.
 * Symbols map to parts through data/kicad.json; the supply comes from a battery symbol, or from power nets
 * (+5V, +3V3... to PSU.+, GND to PSU.-). What can't be mapped is left out and said so, never guessed:
 * the result carries warnings, and `ok` only when nothing was lost.
 *
 *   convert(text, {title, supply}) -> { doc, yaml, warnings, dropped, ok } */
(function (root) {
  "use strict";
  const node = typeof module !== "undefined" && module.exports;
  const D = node ? require("./data.js") : root.BenchData;
  const K = node ? require("./calc.js") : root.BenchCalc;
  const MAP = D.KICAD;

  // ---- S-expressions: ( ... ) lists of atoms and "quoted strings"
  function sexpr(text) {
    let i = 0;
    const s = String(text);
    const read = () => {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] === "(") {
        i++; const list = [];
        for (;;) {
          while (i < s.length && /\s/.test(s[i])) i++;
          if (i >= s.length) throw new Error("the netlist ends in the middle of a list (unbalanced parentheses)");
          if (s[i] === ")") { i++; return list; }
          list.push(read());
        }
      }
      if (s[i] === '"') {
        i++; let out = "";
        while (i < s.length && s[i] !== '"') { if (s[i] === "\\" && i + 1 < s.length) i++; out += s[i++]; }
        i++; return out;
      }
      const st = i;
      while (i < s.length && !/[\s()]/.test(s[i])) i++;
      if (st === i) throw new Error(`unexpected "${s[i]}" at character ${i}`);
      return s.slice(st, i);
    };
    return read();
  }
  const kids = (list, head) => list.filter((x) => Array.isArray(x) && x[0] === head);
  const kid = (list, head) => kids(list, head)[0];
  const val = (list, head) => { const k = kid(list, head); return k ? String(k[1]) : undefined; };

  const glob = (pat, s) => new RegExp("^" + pat.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i").test(s);
  function mapSymbol(libPart, value) {
    for (const m of MAP.symbols) {
      if ((m.lib_part || []).some((p) => glob(p, libPart)) || (m.value || []).some((p) => glob(p, value || ""))) return m;
    }
    return null;
  }
  /** "10uF 25V" -> 1e-5; "100K" -> 1e5; "4R7" -> 4.7 */
  const num = (v) => K.parse(String(v || "").trim().split(/[\s,/]+/)[0].replace(/(ohms?|Ω)$/i, ""));
  /** 100000 -> "100k", 1e-5 -> "10u", 330 -> "330": the shorthand circuit files use */
  function shorthand(x) {
    for (const [f, p] of [[1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "u"], [1e-9, "n"], [1e-12, "p"]])
      if (Math.abs(x) >= f * 0.9995) return String(+(x / f).toPrecision(3)) + p;
    return String(x);
  }
  const COLORS = ["red", "yellow", "green", "blue"];

  function convert(text, opts = {}) {
    const tree = sexpr(text);
    if (!Array.isArray(tree) || tree[0] !== "export") throw new Error("this isn't a KiCad netlist: it should start with (export (version ...");
    const version = val(tree, "version") || "?";
    const warnings = [], dropped = [];
    const design = kid(tree, "design") || [];
    const src = val(design, "source") || "";
    const title = opts.title || (src.split(/[\\/]/).pop() || "KiCad circuit").replace(/\.(kicad_sch|sch)$/i, "");

    // components -> parts (or the supply)
    const parts = {}, pinMap = {}, supplyRefs = [];
    let supplyV = null;
    for (const c of kids(kid(tree, "components") || [], "comp")) {
      const ref = val(c, "ref"), value = val(c, "value") || "";
      if (!ref || ref.startsWith("#")) continue;                          // power flags aren't components
      const ls = kid(c, "libsource") || [];
      const libPart = `${val(ls, "lib") || ""}:${val(ls, "part") || ""}`;
      const m = mapSymbol(libPart, value);
      if (!m) { dropped.push(`${ref} (${libPart}${value ? ", " + value : ""})`); continue; }
      if (m.note) warnings.push(`${ref}: ${m.note}.`);
      pinMap[ref] = m.pins || {};
      if (m.supply) {
        supplyRefs.push(ref);
        const v = num(value);
        if (v > 0 && v <= 30) supplyV = v;
        else warnings.push(`${ref}: its value ("${value}") doesn't say a voltage, so the supply is set to ${opts.supply || 5} V. Edit supply.v if that's wrong.`);
        continue;
      }
      const spec = { part: m.part };
      const P = D.PARTS[m.part];
      if (P.params && P.params.value) {
        const v = num(value);
        if (v > 0) spec.value = shorthand(v);
        else { spec.value = "TODO"; warnings.push(`${ref}: couldn't read a value from "${value}"; fill in value.`); }
      }
      if (P.params && P.params.color) {
        const found = COLORS.find((col) => new RegExp(col, "i").test(value + " " + (val(ls, "part") || "")));
        spec.color = found || "red";
        if (!found) warnings.push(`${ref}: the netlist doesn't say the LED's colour ("${value}"), so it's red; change color if you like.`);
      }
      parts[ref] = spec;
    }
    if (supplyRefs.length > 1) warnings.push(`More than one battery (${supplyRefs.join(", ")}); the game has one bench supply, fed from ${supplyRefs[0]}.`);

    // nets -> nets, with the supply as PSU.+ / PSU.-
    const nets = {}, kicadName = {};
    let posNets = [], gndNets = [];
    for (const n of kids(kid(tree, "nets") || [], "net")) {
      const name = val(n, "name") || `N${val(n, "code")}`;
      const pins = [];
      let psu = null;
      for (const nd of kids(n, "node")) {
        const ref = val(nd, "ref"), pin = val(nd, "pin"), fn = val(nd, "pinfunction");
        if (!ref || ref.startsWith("#")) continue;
        if (supplyRefs[0] === ref) { const id = (fn === "+" || fn === "-") ? fn : (pinMap[ref][pin] || pin); psu = id === "+" ? "PSU.+" : "PSU.-"; continue; }
        if (supplyRefs.includes(ref)) continue;
        if (!parts[ref]) continue;                                        // a dropped component
        const P = D.PARTS[parts[ref].part], ids = P.pins.map((x) => x.id);
        const id = fn && ids.includes(fn) ? fn : (pinMap[ref][pin] || pin);
        if (!ids.includes(id)) { warnings.push(`${ref} pin ${pin}${fn ? ` (${fn})` : ""} doesn't match a ${P.name.toLowerCase()} pin (${ids.join(", ")}); left out.`); continue; }
        pins.push(`${ref}.${id}`);
      }
      const bare = name.replace(/^\//, "");
      if (!psu && !supplyRefs.length) {
        if (MAP.ground_nets.some((g) => g.toLowerCase() === bare.toLowerCase())) psu = "PSU.-";
        else if (Object.keys(MAP.power_nets).some((p) => p.toLowerCase() === bare.toLowerCase())) { psu = "PSU.+"; posNets.push(bare); }
      }
      if (psu) pins.unshift(psu);
      if (psu === "PSU.-") gndNets.push(bare);
      if (pins.length < 2) continue;                                      // a pin wired to nothing: in no net
      const auto = /^(Net-|unconnected-|N\$|\$)/i.test(bare) || !/^[A-Za-z_+][\w+.-]*$/.test(bare);   // "+5V" is a real name
      let key = auto ? `N${val(n, "code") || Object.keys(nets).length + 1}` : bare.replace(/[^\w+.-]/g, "_");
      while (nets[key]) key += "_";
      nets[key] = pins;
      if (auto) kicadName[key] = name;
    }
    if (posNets.length > 1) {                                             // two positive rails: only one bench supply
      warnings.push(`Several supply nets (${posNets.join(", ")}); the game has one bench supply. All but ${posNets[0]} are kept as plain nets.`);
      for (const k of posNets.slice(1)) if (nets[k]) nets[k] = nets[k].filter((p) => p !== "PSU.+");
    }
    if (!supplyRefs.length && posNets.length) { const v = MAP.power_nets[Object.keys(MAP.power_nets).find((p) => p.toLowerCase() === posNets[0].toLowerCase())]; if (v) supplyV = v; else warnings.push(`The supply net is "${posNets[0]}", which doesn't say a voltage, so the supply is set to ${opts.supply || 5} V.`); }
    if (!supplyRefs.length && !posNets.length) warnings.push("No battery and no power net (+5V, +3V3, VCC...), so nothing connects to PSU.+. Add PSU.+ to the net the supply feeds.");
    if (!gndNets.length) warnings.push("No ground net (GND) and no battery, so nothing connects to PSU.-. Add PSU.- to the ground net.");
    if (dropped.length) warnings.unshift(`Left out (no Strip & Rail part for them yet): ${dropped.join("; ")}. Their pins are removed from the nets.`);

    const doc = { format: "strip-and-rail/circuit@1", title, about: `Imported from a KiCad netlist (format ${version}).`,
      supply: { v: opts.supply || supplyV || 5, ilim: "100m" }, parts, nets, win: [{ wiring: "nets" }] };
    return { doc, yaml: toYaml(doc, warnings, kicadName), warnings, dropped, ok: !dropped.length && !warnings.some((w) => /TODO|nothing connects/.test(w)) };
  }

  /** Our circuit format as YAML, with the warnings as comments at the top and KiCad's auto net names beside ours. */
  function toYaml(doc, warnings, kicadName) {
    const q = (s) => (/^[\w+.\-]+$/.test(s) ? s : JSON.stringify(s));
    const L = ["# Converted from a KiCad netlist by Strip & Rail (docs/KICAD.md). Check it before trusting it."];
    for (const w of warnings) L.push("# NOTE: " + w);
    L.push(`format: ${doc.format}`, `title: ${JSON.stringify(doc.title)}`, `about: ${JSON.stringify(doc.about)}`,
      `supply: { v: ${doc.supply.v}, ilim: ${doc.supply.ilim} }`, "", "parts:");
    const w = Math.max(3, ...Object.keys(doc.parts).map((r) => r.length + 1));
    for (const [ref, sp] of Object.entries(doc.parts))
      L.push(`  ${(ref + ":").padEnd(w)} { ${Object.entries(sp).map(([k, v]) => `${k}: ${q(String(v))}`).join(", ")} }`);
    L.push("", "nets:");
    const nw = Math.max(3, ...Object.keys(doc.nets).map((r) => r.length + 1));
    for (const [name, pins] of Object.entries(doc.nets))
      L.push(`  ${(q(name) + ":").padEnd(nw)} [${pins.join(", ")}]${kicadName[name] ? `      # KiCad: ${kicadName[name]}` : ""}`);
    L.push("", "win:", "  - wiring: nets", "  # add behaviour goals here (docs/CIRCUITS.md), e.g.  - goal: { kind: lit, count: 1, min: 4m, max: 25m }", "");
    return L.join("\n");
  }

  const api = { sexpr, convert, toYaml };
  if (node) module.exports = api; else root.BenchKiCad = api;
})(typeof window !== "undefined" ? window : globalThis);
