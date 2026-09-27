#!/usr/bin/env node
/* Bundle data/ into one object: { parts, cards, levels, sandbox, rules }.
 *   node tools/bundle.js            print it as JSON (build.py embeds it in the page)
 *   require("./tools/bundle.js").bundle()   the same object, for src/data.js under node (the tests)
 * Order comes from data/cards/order.json and data/levels/order.json; parts are keyed by id. */
const fs = require("fs"), path = require("path");
const DATA = path.join(__dirname, "..", "data");
const read = (...p) => JSON.parse(fs.readFileSync(path.join(DATA, ...p), "utf8"));

function bundle() {
  const parts = fs.readdirSync(path.join(DATA, "parts")).filter((f) => f.endsWith(".json")).sort().map((f) => read("parts", f));
  const cardOrder = read("cards", "order.json").cards;
  const cardFiles = fs.readdirSync(path.join(DATA, "cards")).filter((f) => f.endsWith(".json") && f !== "order.json").map((f) => f.slice(0, -5));
  const unlisted = cardFiles.filter((id) => !cardOrder.includes(id));
  if (unlisted.length) throw new Error(`data/cards: ${unlisted.join(", ")} not in cards/order.json`);
  const cards = cardOrder.map((id) => read("cards", id + ".json"));
  const lo = read("levels", "order.json");
  const levels = lo.levels.map((id) => read("levels", id + ".json"));
  const sandbox = read("levels", lo.sandbox + ".json");
  const rules = read("rules.json").rules;
  // examples/<name>/circuit.yaml: shipped as text; the game loads them through the same importer players use
  const EXD = path.join(__dirname, "..", "examples");
  const examples = fs.existsSync(EXD) ? fs.readdirSync(EXD).sort().filter((d) => fs.existsSync(path.join(EXD, d, "circuit.yaml")))
    .map((d) => ({ id: d, text: fs.readFileSync(path.join(EXD, d, "circuit.yaml"), "utf8") })) : [];
  const kicad = read("kicad.json");
  return { parts, cards, levels, sandbox, rules, examples, kicad };
}
if (require.main === module) process.stdout.write(JSON.stringify(bundle()));
module.exports = { bundle };
