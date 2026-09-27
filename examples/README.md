# Examples: from schematic to circuit file

Five common circuits and one real project, each as a schematic and the circuit file that describes it. They load in the game under
**Examples** through the same importer you'd use for your own. The format is in [docs/CIRCUITS.md](../docs/CIRCUITS.md).

**The method, every time:**

1. **Parts.** Every symbol with a designator (R1, LED1, U1) is one line under `parts:`, with its value.
2. **Nets.** Put a finger on a pin and follow the wire through every junction dot. Every pin you reach, in any
   direction, is in the same net. Write them down, give the net a name, and start on the next unvisited pin.
3. **The supply.** The battery or supply symbol's + and − are `PSU.+` and `PSU.-`. Ground symbols are all one
   net: they're joined even when no wire is drawn between them.
4. **Leftovers.** A chip pin with nothing attached (marked n/c) goes in no net.
5. **Win.** `wiring: nets`, plus a behaviour goal if the circuit does something you can test.

---

## 1. Hello, LED · [`01-hello-led/circuit.yaml`](01-hello-led/circuit.yaml)

![](01-hello-led/schematic.svg)

Three wires in the drawing, so three nets: + to R1 (**VCC**), R1 to the LED's anode (**A**), and the LED's
cathode back through the ground symbol to − (**GND**). An LED's pins are `A` (anode, the long leg) and `K`
(cathode, the flat side), and the triangle in its symbol points from A to K.

## 2. Two LEDs in parallel · [`02-parallel-leds/circuit.yaml`](02-parallel-leds/circuit.yaml)

![](02-parallel-leds/schematic.svg)

The junction dot after the supply means one net reaches both resistors: `VCC: [PSU.+, R1.1, R2.1]`. The
bottom line joins both cathodes and −, so that's one net too. R1 and R2 are both 330 Ω, so the check doesn't
care which one you put in which branch.

## 3. Reverse-polarity protection · [`03-reverse-protect/circuit.yaml`](03-reverse-protect/circuit.yaml)

![](03-reverse-protect/schematic.svg)

A diode in the supply line. Its pins are `A` and `K` like an LED's (the bar in the symbol is the band on the
part), and it must go the right way round. Four wires, four nets: `IN`, `VP` (after the diode), `A`, `GND`.

## 4. 555 blinker · [`04-555-blinker/circuit.yaml`](04-555-blinker/circuit.yaml)

![](04-555-blinker/schematic.svg)

The game's level 10 as a file. A chip's pins are the datasheet's numbers: `U1.8` is pin 8. Two things the drawing
does for you: the **+5 V flags** are all the same net (VCC), and **every ground symbol** is GND. Pins 2 and 6 both
touch the capacitor's line, so they share a net (`TIM`). Pin 5 is marked n/c: it's in no net, and the check
makes sure it stays unconnected.

## 5. 555 alternating flasher · [`05-555-flasher/circuit.yaml`](05-555-flasher/circuit.yaml)

![](05-555-flasher/schematic.svg)

The blinker plus one branch: R4 and LED2 hang from +5 V into the output. The output's net now has three pins,
`OUT: [U1.3, R3.1, LED2.K]`, because pin 3 feeds LED1's resistor and takes LED2's cathode. When the output is
HIGH, LED1 lights; when it's LOW, pin 3 pulls LED2's cathode down and LED2 lights. (The file's comments explain
why LED2 stays dark while the output is high.)

## 6. A real project: the horn detector's wake circuit · [`06-horn-wake/circuit.yaml`](06-horn-wake/circuit.yaml)

![](06-horn-wake/schematic.svg)

From a real build: the train-horn detector, whose ESP32 sleeps until something loud happens. Read it left to
right as a pipeline: C1 and R1 strip the microphone's 1.25 V offset, D1 keeps the positive peaks, C2 and R2
smooth them into an **envelope** (how loud, lately), and comparator A of U1 compares that with a **threshold**
set by R3 and RV1. Loud enough, and the open-collector output lets go, so R4 pulls **WAKE** high.

Three translation details:
- The comparator symbol is only half the chip. Its **power pins** (8, 4) and the **unused half** (5 to GND,
  6 to VCC, 7 free) are written as a note on the drawing, but they're real connections, so they go in the nets.
- Every **+3.3 V flag** is the VCC net, and every ground symbol is GND, including the tone source's and the ESP32's.
- The win condition is **two listen goals**: a horn-level sound must read HIGH on the ESP32 pin, and a
  conversation-level one must read LOW. Turn RV1 up in the game and even a horn won't wake it: that's what the
  trimmer is for on the bench.

---

**Adding an example:** a folder with `circuit.yaml`, a drawing in `examples/draw.py`, and a section here.
`node --test test/` loads every example, and `test/circuit.test.js` holds a correct breadboard build of each.
