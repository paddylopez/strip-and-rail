"""Draw each example's schematic next to its circuit file: examples/<name>/schematic.svg.
    python3 examples/draw.py
Reuses the game's Schemdraw helpers (schematics/draw.py). Commit the SVGs: GitHub shows them in examples/README.md."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "schematics"))
import schemdraw.elements as elm
import draw as g          # the game's drawings and helpers


def hello(d):
    g.light(d)


def parallel(d):
    s = elm.SourceV().up().label("5 V", loc="bottom")
    elm.Line().right(d.unit * 0.4)
    j = elm.Dot()
    elm.Resistor().right().label("R1\n330 Ω")
    elm.LED().down().toy(s.start).label("LED1\nred", loc="bottom")
    k = elm.Dot()
    elm.Line().at(j.center).up(d.unit * 0.8)
    elm.Line().right(d.unit * 2.2)
    elm.Resistor().right().label("R2\n330 Ω")
    elm.LED().down().toy(s.start).label("LED2\ngreen", loc="bottom")
    elm.Line().left().tox(s.start)
    elm.Ground().at(s.start)


def reverse(d):
    s = elm.SourceV().up().label("5 V", loc="bottom")
    elm.Line().right(d.unit * 0.4)
    elm.Diode().right().label("D1\n1N4148")
    elm.Resistor().right().label("R1\n330 Ω")
    elm.LED().down().toy(s.start).label("LED1\nyellow", loc="bottom")
    elm.Line().left().tox(s.start)
    elm.Ground().at(s.start)


def flasher(d):
    g.blink(d)
    # LED2 hangs from +5 V through R4 into the output node: it lights while the output is LOW (pin 3 sinks)
    u = [e for e in d.elements if isinstance(e, elm.Ic)][0]
    n = (u.OUT[0] + 1.0, u.OUT[1])
    elm.Dot().at(n)
    elm.LED().at(n).up().reverse().label("LED2\ngreen", loc="top")      # label on the left, clear of R3
    elm.Resistor().up().label("R4\n330 Ω", loc="bottom")
    elm.Vdd().label("+5 V")


def horn(d):
    """The horn detector's wake circuit, on the game's 3.3 V supply."""
    d.config(fontsize=11, unit=2.4)
    elm.Dot(open=True).label("MIC\nOUT", loc="left")
    elm.Capacitor().right().label("C1\n1 µF")
    elm.Dot()
    d.push(); elm.Resistor().down().label("R1\n100 kΩ", loc="bottom"); elm.Ground(); d.pop()
    elm.Diode().right().label("D1\n1N4148")
    elm.Dot()
    d.push(); elm.Capacitor(polar=True).down().label("C2\n1 µF", loc="bottom"); elm.Ground(); d.pop()
    elm.Line().right(d.unit * 0.8)
    elm.Dot().label("ENV", loc="top")
    d.push(); elm.Resistor().down().label("R2\n470 kΩ", loc="bottom"); elm.Ground(); d.pop()
    elm.Line().right(d.unit * 0.6)
    op = elm.Opamp(leads=True).anchor("in2").right().label("U1A\nLM393", loc="center", ofst=(-0.3, 0))
    elm.Label().at(op.in2).label("3", loc="bottom", ofst=(0.25, -0.05))
    elm.Label().at(op.in1).label("2", loc="top", ofst=(0.25, 0.05))
    elm.Line().at(op.in1).left(d.unit * 0.6)
    elm.Line().up(d.unit * 1.0)
    elm.Line().left(d.unit * 1.0)
    pot = elm.Potentiometer().down().anchor("tap").reverse().label("RV1\n100 kΩ", loc="top")
    elm.Ground().at(pot.end)
    elm.Resistor().at(pot.start).up().label("R3\n330 kΩ")
    elm.Vdd().label("+3.3 V")
    elm.Line().at(op.out).right(d.unit * 0.8).label("1", loc="top", ofst=(-0.6, 0))
    elm.Dot()
    d.push(); elm.Resistor().up().label("R4\n10 kΩ"); elm.Vdd().label("+3.3 V"); d.pop()
    elm.Line().right(d.unit * 1.0)
    elm.Dot(open=True).label("ESP32\nGPIO33\n(wake)", loc="right")
    elm.Label().at((op.out[0] - 1.5, op.out[1] - 5.2)).label(
        "U1 (LM393): pin 8 → +3.3 V, pin 4 → GND, C3 100 nF across 8–4 at the chip.\n"
        "Unused half: pin 5 → GND, pin 6 → +3.3 V, pin 7 free.  MIC: VDD → +3.3 V, GND → GND.", loc="center")


if __name__ == "__main__":
    for name, fn in [("01-hello-led", hello), ("02-parallel-leds", parallel), ("03-reverse-protect", reverse),
                     ("04-555-blinker", g.blink), ("05-555-flasher", flasher), ("06-horn-wake", horn)]:
        g.save(name, fn, path=os.path.join(HERE, name, "schematic.svg"))
        print("  drew examples/%s/schematic.svg" % name)
