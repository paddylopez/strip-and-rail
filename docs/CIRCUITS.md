# Circuit files: your own circuits as levels

A circuit file describes a schematic the way the game needs it: **a parts list and a netlist**. Load one with
**Import a circuit…** (or drop the file anywhere on the page) and it becomes a level: the bin holds each part
by its designator, the cards for its parts are dealt, and Check compares your breadboard with the netlist.
YAML or JSON; the files in [examples/](../examples/README.md) are worked translations of real schematics. Drawn it in
KiCad? Drop the netlist instead: [KICAD.md](KICAD.md).

```yaml
format: strip-and-rail/circuit@1          # required, always this
title: Hello, LED                         # required
about: One line on what it is and why.    # optional; shown under the title and after you win
supply: { v: 5, ilim: 100m }              # the bench supply: volts, and the current limit (default 100m)

parts:                                    # designator -> part
  R1:   { part: resistor, value: 330 }
  LED1: { part: led, color: red }

nets:                                     # net name -> the pins it joins
  VCC: [PSU.+, R1.1]
  A:   [R1.2, LED1.A]
  GND: [LED1.K, PSU.-]

win:                                      # optional; default: [ { wiring: nets } ]
  - wiring: nets
  - goal: { kind: lit, count: 1, min: 4m, max: 25m }

brief: [ "optional steps, one per line" ] # default: how to read the bin and the Connections list
cards: [ envelope ]                       # optional: extra cards to deal (techniques); parts' cards come automatically
```

## Parts

`part:` is a part id from `data/parts/`: `resistor`, `led`, `capacitor` (ceramic), `electrolytic`, `diode`,
`button`, `pot`, `ne555`, `lm393` (dual comparator), `tone` (a tone source standing in for a microphone
breakout), `esp32pin` (a microcontroller input to test against). Values take the usual shorthand: `330`, `4k7`, `68k`, `10u`, `100n`. LEDs take
`color: red | yellow | green | blue`. Wires aren't parts here: the nets say what's joined, and the player
chooses the wires.

## Pins

A pin is `DESIGNATOR.PIN`, using the part's pin ids:

| Part | Pins |
|---|---|
| resistor, capacitor, button | `1`, `2` (either way round) |
| led, diode | `A` (anode, +), `K` (cathode, −) |
| electrolytic | `+`, `-` |
| pot | `1`, `W` (wiper), `3` (the two ends swap freely) |
| ne555 | `1`–`8`, the datasheet's numbers: 1 GND, 2 TRIG, 3 OUT, 4 RESET, 5 CTRL, 6 THR, 7 DIS, 8 VCC |
| lm393 | `1`–`8`: 1 OUT A, 2 IN− A, 3 IN+ A, 4 GND, 5 IN+ B, 6 IN− B, 7 OUT B, 8 VCC (open-collector outputs) |
| tone | `VDD`, `GND`, `OUT` (1.25 V offset; the Sound control picks off / talk 0.2 V / horn 1 V, at 300 Hz) |
| esp32pin | `GPIO`, `GND` (reads HIGH at ≥ 0.75 × supply, LOW at ≤ 0.25 ×) |
| the bench supply | `PSU.+`, `PSU.-` (every circuit connects both) |

## Nets, and how they're checked

A net is every pin one piece of wire touches in the schematic: follow a line from a pin through every junction
dot and list what it reaches. Name it anything (VCC, GND, OUT, N1); the names appear in hints.

Check passes when your breadboard joins **exactly** those pins:

- **Any layout.** Rows, columns, which strip: only what's connected matters.
- **Identical parts are interchangeable.** Two 330 Ω resistors may trade places.
- **Parts without polarity may turn round.** Resistors, ceramic capacitors, buttons, a pot's two ends.
  LEDs, diodes, electrolytics and chips may not.
- **A pin in no net is left free.** In the 555 examples, pin 5 (CTRL) isn't listed, so connecting it is an error.

When it doesn't match, the hints name the net: *"Net GND isn't all connected. GND should join LED1's short
leg and the supply's − terminal…"*, *"Nets VCC and A are joined, but the schematic keeps them apart"*,
*"U1.5 is connected to net GND, but the schematic leaves it unconnected"*.

## Winning

`win` lists conditions; all must hold. `wiring: nets` is the netlist check. `goal:` adds a behaviour test, run
in the simulator, using the same goals as the built-in levels:

| goal.kind | Passes when | Fields |
|---|---|---|
| `lit` | every LED lights, within the range | `count`, `min`, `max` |
| `button` | LEDs dark until a button is held | `min`, `max` |
| `blink` | an LED flashes in the frequency range | `fmin`, `fmax`, `seconds` |
| `afterglow` | an LED keeps glowing after the button is released | `hold`, `min`, `max`, `minGlow`, `maxGlow` |
| `latch` | one button sets, another resets | `min` |
| `oneshot` | one press gives one timed pulse | `min`, `minPulse`, `maxPulse` |
| `listen` | after settling quietly, a sound makes the `esp32pin` read HIGH or LOW | `sound: talk\|horn`, `expect: high\|low`, `settle` (s), `listen` (s) |
| `dimmer`, `divider` | a pot sweeps brightness / sets a voltage | see `checkGoal` in `src/engine.js` |

Behaviour goals catch what wiring can't: a circuit that's wired right but has the wrong values.

## When a file won't load

The game lists every problem with where it is, for example `nets.VCC: "U1.9": a 555 timer's pins are 1, 2, …`
or `parts.R1: a resistor needs a value`. The same checks run in `test/circuit.test.js`.
