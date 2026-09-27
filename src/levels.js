/* Strip & Rail levels: data/levels/<id>.json, in the order of data/levels/order.json (see src/data.js).
 * Each level: a schematic to build, a parts bin, a supply, the cards it introduces, and a goal the simulator
 * checks (see checkGoal in engine.js). Goals are about what the circuit DOES, so any layout that works passes. */
(function (root) {
  "use strict";
  const D = typeof module !== "undefined" && module.exports ? require("./data.js") : root.BenchData;
  const api = { LEVELS: D.LEVELS, SANDBOX: D.SANDBOX };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BenchLevels = api;
})(typeof window !== "undefined" ? window : globalThis);
