/* Strip & Rail: the Rulebook, from data/rules.json. Definitions and laws are the axioms; theorems are proved
 * from them two-column (statement | reason). In a reason, "@id" links to that rule; statements may use
 * <sub>, <sup>, <del>. unlock: the level id that introduces the rule. test/rules.test.js checks the structure. */
(function (root) {
  "use strict";
  const D = typeof module !== "undefined" && module.exports ? require("./data.js") : root.BenchData;
  const RULES = D.RULES;
  const BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r]));
  const api = { RULES, BY_ID };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BenchRules = api;
})(typeof window !== "undefined" ? window : globalThis);
