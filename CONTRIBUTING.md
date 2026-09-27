# Contributing

Thanks for helping. Most contributions are **data**, not code, and the tests tell you when something doesn't fit.

## The loop

```
node --test test/        # must pass; test/data.test.js names the file and the field when something doesn't resolve
./build.py               # runs the tests, draws the schematics, writes dist/strip-and-rail.html
```

Open `dist/strip-and-rail.html` in a browser to try it. Commit the rebuilt `dist/` with your change.

## What you might add

| Adding | Where | Guide |
|---|---|---|
| A part of a kind the solver already runs (another diode, LED colour, DIP comparator) | `data/parts/<id>.json`, and its card | [docs/DATA.md](docs/DATA.md) |
| A card (a part's, or a technique) | `data/cards/<id>.json` + `data/cards/order.json` | [docs/DATA.md](docs/DATA.md) |
| A level | `data/levels/<id>.json` + `data/levels/order.json`, a schematic in `schematics/draw.py` | [docs/DATA.md](docs/DATA.md) |
| An example circuit | `examples/<nn-name>/circuit.yaml`, its drawing in `examples/draw.py`, a section in `examples/README.md` | [docs/CIRCUITS.md](docs/CIRCUITS.md) |
| A KiCad symbol mapping | a line in `data/kicad.json` | [docs/KICAD.md](docs/KICAD.md) |
| A Rulebook rule or proof | `data/rules.json` (the tests check every reason cites a rule it declares) | [docs/DATA.md](docs/DATA.md) |
| A new kind of physics (transistors, logic gates) | `src/engine.js` (the element), `src/ui.js` (how it draws), with tests | read the engine's comments first |

## Rules of the house

- **Facts come from datasheets.** Pinouts and ratings on a part or card come from its datasheet: link it in
  the part's `"datasheet"` field. A wrong pinout teaches people to wire the real chip wrong.
- **Goals judge behaviour, not layout.** If a level can only be solved one way, it's a bad level.
- **Hints say what's wrong in terms of the board**, and escalate: a nudge, then the specific cause, then the fix.
- **Write for someone learning.** Short sentences, plain words, one new idea at a time.
- **Tests for physics.** A change to the solver comes with a test that checks it against a hand-worked value.
