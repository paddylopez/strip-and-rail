#!/usr/bin/env node
/* KiCad netlist -> Strip & Rail circuit file.
 *   node tools/kicad2circuit.js project.net [--title "My circuit"] [--supply 5] > circuit.yaml
 * The circuit file goes to stdout, notes to stderr. Exit 0: clean. Exit 1: converted, but something was
 * left out or needs filling in (the file's NOTE lines say what). Exit 2: couldn't read the netlist.
 * In KiCad: Eeschema, File > Export > Netlist (KiCad format); or  kicad-cli sch export netlist -o project.net project.kicad_sch */
const fs = require("fs");
const KC = require("../src/kicad.js");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const title = opt("--title"), supply = opt("--supply");
if (!args[0]) { console.error("usage: node tools/kicad2circuit.js project.net [--title T] [--supply V]"); process.exit(2); }
let r;
try { r = KC.convert(fs.readFileSync(args[0], "utf8"), { title, supply: supply ? +supply : undefined }); }
catch (e) { console.error(`  !! ${args[0]}: ${e.message}`); process.exit(2); }
process.stdout.write(r.yaml);
for (const w of r.warnings) console.error("  note: " + w);
process.exit(r.ok ? 0 : 1);
