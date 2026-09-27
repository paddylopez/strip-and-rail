# The data formats

Everything a player sees about a part, a card, a level or a rule lives in `data/` as JSON. Adding one is a
data change; `node --test test/` checks it (test/data.test.js names the file and the field when something
doesn't resolve), and `./build.py` bundles it into the page.

```
data/
  parts/<id>.json      one part: where its legs go, what they're called, which model runs it, how it's drawn
  cards/<id>.json      one card; data/cards/order.json sets the collector numbers
  levels/<id>.json     one level; data/levels/order.json sets the order (and names the sandbox)
  rules.json           the Rulebook: definitions, laws, theorems with two-column proofs
```

## A part (`data/parts/<id>.json`)

Annotated below; the real files are plain JSON, without the `//` comments.

```jsonc
{
  "id": "led",                                  // = the file name; builds and levels refer to parts by it
  "name": "LED",
  "prefix": "LED",                              // placed parts are numbered LED1, LED2...
  "footprint": { "kind": "two-lead", "span": [0.9, 3.5] },   // or {"kind":"dip","pins":8}, {"kind":"row","pins":3}
  "pins": [                                     // two-lead parts: in placement order (first click, second click)
    { "id": "A", "name": "long leg (anode, +)", "label": "+", "positive": true },
    { "id": "K", "name": "short leg (cathode, −)", "label": "−" }
  ],
  "params": { "color": { "options": { "red": { "name": "Red", "vf": 2.0, "rgb": [255, 45, 35] } } } },
  "model": { "kind": "led", "rs": 10, "n": 2, "iMax": 0.030, "iBurn": 0.045 },
  "draw": "led",
  "card": "led",
  "label": "{color} LED"                        // the bin label: {param} or {param:unit}, e.g. "{value:Ω} resistor"
}
```

- **span** is in holes (0.1 in), lead to lead: a resistor is 3–10, an LED 1–3.
- **pins[].name** is what hints and hover say ("LED1's long leg (anode, +)"); **label** is printed on the board;
  **optional: true** means a leg may be left unconnected without a hint (the 555's pins 5 and 7).
- **model.kind** is the physics, and must be one the solver implements: `wire`, `resistor`, `led`, `diode`,
  `capacitor` (`"polarised": true` for electrolytics, with the + pin first), `button`, `pot`, `ne555`,
  `comparator` (any open-collector comparator: `channels` of `{inp, inn, out}`, `vcc`, `gnd`, `ron`, `iq`, `hyst`),
  `tone` (a signal source: `offset`, `freq`, `levels`), `logicin` (a digital input: `vih`, `vil` as fractions of the supply).
  So an LM339 (quad comparator, DIP-14) is data only: four channels.
  A new part of an existing kind is data only (a 1N4001 is a `diode` with different `is` and `n`; an orange
  LED is one more colour). A new kind (a comparator, logic gates) needs its element in `src/engine.js`,
  its `draw` in `src/ui.js` if it looks different, and tests.
- **draw**: `wire`, `resistor`, `led`, `diode`, `capacitor`, `electrolytic`, `button`, `pot`, `dip`, `module`. Any DIP
  chip uses `dip` and prints its `"chip"` field on the body with the pin numbers; a breakout board uses `module`
  with a row footprint and `"board": {"color", "title", "mic"?, "led"?}`, printing each pin's `"short"` name.
- Pinouts and ratings come from the datasheet; put its link in `"datasheet"`.

## A card (`data/cards/<id>.json`)

```json
{ "id": "resistor", "name": "Resistor", "cost": "≈ 2¢", "frame": "passive", "type": "Passive — Resistor",
  "rarity": "C", "art": "resistor", "symbol": "sym_resistor",
  "rules": [["Limits current", "I = V ÷ R: more ohms, less current."], ["Either way round", "No polarity."]],
  "stats": "{value:Ω|330} · ¼ W", "flavor": "Every LED's bodyguard." }
```

- **frame**: `basic`, `passive`, `semi`, `switch`, `ic`, `tool`, `technique` (ideas, not parts). **rarity**: `B`, `C`, `U`, `R`.
- **rules**: `["Keyword", "reminder text"]` renders as **Keyword** *(reminder)*; a one-item entry is plain text.
- **stats**: `{param:unit|default}` is filled from the part the card is shown for (its value, its colour's `vf`).
- **art** names a generator in `src/cards.js`; **symbol** a schematic symbol drawn by `schematics/draw.py`.
- Add the id to `data/cards/order.json`: that's its collector number.

## A level (`data/levels/<id>.json`)

```json
{ "id": "light", "title": "Light it up", "schematic": "light",
  "cards": [{ "id": "led", "color": "red" }, { "id": "resistor", "value": 330 }],
  "supply": { "v": 5, "ilim": 0.1 },
  "brief": ["…", "…"], "lesson": "…",
  "bin": [{ "type": "resistor", "value": 330, "count": 1 }, { "type": "led", "color": "red", "count": 3 }, { "type": "wire", "count": null }],
  "preset": [{ "id": "W1", "type": "wire", "color": "red", "pins": { "a": "PSU.+", "b": "T+5" } }],
  "goal": { "kind": "lit", "count": 1, "min": 0.004, "max": 0.025 } }
```

- **count: null** is unlimited. Values may be numbers or strings: `"10u"`, `"4k7"`, `"330"`.
- **preset** parts are glued down; add `"free": true` to let the player pull one (level 13's loop wire).
- Holes are `a1`–`j63`, rails `T-3`, `T+3`, `B-3`, `B+3` (every sixth rail position is a gap), supply terminals `PSU.+`, `PSU.-`.
- **goal.kind**: `lit`, `button`, `dimmer`, `blink`, `afterglow`, `latch`, `oneshot`, `divider`, `ammeter` (see `checkGoal` in
  `src/engine.js` for each one's fields). Goals judge what the circuit does, so any working layout passes.
- **schematic** names a function in `schematics/draw.py`. **boss: true** marks a boss level.
- Add the id to `data/levels/order.json`. Rules and calculators unlock by level id, so reordering is safe.

## The Rulebook (`data/rules.json`)

Each rule: `id`, `g` (its short name in the graph), `kind` (`definition`, `law`, `theorem`), `unlock` (a level id),
`title`, `short`, `plain`, `uses` (the rules it's built on), and for a theorem `given` and `proof`: rows of
`["statement", "reason"]`, where `@id` in a reason links to that rule. test/rules.test.js holds the proofs to account:
every `@id` cited must be in `uses`, nothing may lean on a rule that unlocks later, and there are no cycles.
