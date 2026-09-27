// The Rulebook checked like a proof: every reason cites a real rule the theorem declares it uses; nothing is
// used before it's unlocked; the dependencies have no cycles; every theorem ends in a ∎.
const test = require("node:test");
const assert = require("node:assert/strict");
const { RULES, BY_ID } = require("../src/rules.js");
const { LEVELS } = require("../src/levels.js");
const order = Object.fromEntries(LEVELS.map((l, i) => [l.id, i]));
const refs = (s) => [...String(s).matchAll(/@(\w+)/g)].map((m) => m[1]);

test("every rule unlocks at a real level, and every theorem has a proof ending in ∎", () => {
  for (const r of RULES) {
    assert.ok(r.unlock in order, `${r.id}: unlock level "${r.unlock}"`);
    if (r.kind === "theorem") {
      assert.ok(r.proof && r.proof.length >= 3, `${r.id}: a proof`);
      assert.ok(r.proof.some(([st]) => st.includes("∎")), `${r.id}: the proof concludes`);
    }
  }
});

test("each reason cites only rules the theorem declares it uses", () => {
  for (const r of RULES) {
    for (const u of r.uses) assert.ok(BY_ID[u], `${r.id} uses unknown rule ${u}`);
    for (const [, reason] of r.proof || []) for (const id of refs(reason)) {
      assert.ok(BY_ID[id], `${r.id}: reason cites unknown @${id}`);
      assert.ok(r.uses.includes(id), `${r.id}: cites @${id} but doesn't list it in uses`);
    }
    for (const id of refs(r.given || "")) assert.ok(r.uses.includes(id), `${r.id}: given cites @${id} not in uses`);
  }
});

test("nothing is used before it's unlocked", () => {
  for (const r of RULES) for (const u of r.uses)
    assert.ok(order[BY_ID[u].unlock] <= order[r.unlock], `${r.id} (level ${order[r.unlock] + 1}) leans on ${u} (level ${order[BY_ID[u].unlock] + 1})`);
});

test("the dependencies have no cycles (it's a proof, not an argument in a circle)", () => {
  const state = {};
  const visit = (id, path) => {
    assert.notEqual(state[id], "open", `cycle: ${[...path, id].join(" → ")}`);
    if (state[id] === "done") return;
    state[id] = "open"; for (const u of BY_ID[id].uses) visit(u, [...path, id]); state[id] = "done";
  };
  for (const r of RULES) visit(r.id, []);
});

test("definitions stand on nothing but other definitions", () => {
  for (const r of RULES.filter((x) => x.kind === "definition")) for (const u of r.uses) assert.equal(BY_ID[u].kind, "definition", `${r.id} uses ${u}`);
});
