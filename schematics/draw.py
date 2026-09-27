"""Level schematics and part symbols for bench-sim, drawn with Schemdraw (SVG backend: small files, real text).
    python3 schematics/draw.py OUTDIR      -> OUTDIR/<name>.svg
Names: level schematics (light, series, button, dimmer, blink) and part symbols (sym_<part>)."""
import os, sys
import schemdraw
import schemdraw.elements as elm

schemdraw.use("svg")
OUT = None          # set by main (or by examples/draw.py, which reuses these helpers)


def save(name, draw, unit=2.2, fontsize=12, path=None):
    with schemdraw.Drawing(file=path or os.path.join(OUT, name + ".svg"), show=False) as d:
        d.config(unit=unit, fontsize=fontsize)
        draw(d)


def supply(d):
    """The bench supply as a battery symbol: + on top."""
    b = elm.BatteryCell().up().label("5 V\nsupply", loc="bottom")
    return b


def light(d):
    s = elm.SourceV().up().label("5 V", loc="bottom")
    elm.Line().right(d.unit * 0.4)
    elm.Resistor().right().label("R1\n330 Ω")
    elm.LED().down().label("LED1\nred", loc="bottom")
    elm.Line().left().tox(s.start)
    elm.Ground().at(s.start)


def series(d):
    s = elm.SourceV().up().label("5 V", loc="bottom")
    elm.Line().right(d.unit * 0.4)
    elm.Resistor().right().label("R1\n150 Ω")
    elm.LED().down().label("LED1\ngreen", loc="bottom")
    elm.LED().down().label("LED2\ngreen", loc="bottom")
    b = elm.Line().left().tox(s.start)
    elm.Line().up().toy(s.start)
    elm.Ground().at(b.end)


def button(d):
    s = elm.SourceV().up().label("5 V", loc="bottom")
    elm.Line().right(d.unit * 0.4)
    elm.Button().right().label("SW1")
    elm.Resistor().right().label("R1\n330 Ω")
    elm.LED().down().label("LED1\nyellow", loc="bottom")
    elm.Line().left().tox(s.start)
    elm.Ground().at(s.start)


def dimmer(d):
    s = elm.SourceV().up().label("5 V", loc="bottom")
    elm.Line().right(d.unit * 0.4)
    elm.Resistor().right().label("R1\n220 Ω")
    pot = elm.Potentiometer().right().label("RV1\n10 kΩ", loc="bottom")
    elm.Label().at((pot.end[0] + 0.15, pot.end[1])).label("3: n/c", fontsize=10, halign="left")
    elm.Line().at(pot.tap).up(d.unit * 0.35)                      # the wiper carries the current on
    elm.Line().right().tox(pot.end[0] + d.unit * 0.9)
    elm.LED().down().toy(s.start).label("LED1\nblue", loc="bottom")
    elm.Line().left().tox(s.start)
    elm.Ground().at(s.start)


def divider(d):
    s = elm.SourceV().up().label("5 V", loc="bottom")
    elm.Line().right(d.unit * 1.6)
    pot = elm.Potentiometer().down().toy(s.start).label("RV1\n10 kΩ", loc="top")      # the ends span the supply
    elm.Line().left().tox(s.start)
    elm.Ground().at(s.start)
    elm.Line().at(pot.tap).right(d.unit * 0.9)
    elm.Dot(open=True).label("wiper: V out\n(measure here)", loc="right")


def ammeter(d):
    s = elm.SourceV().up().label("5 V", loc="bottom")
    elm.Line().right(d.unit * 0.4)
    elm.Resistor().right().label("R1\n330 Ω")
    elm.LED().down().label("LED1\nred", loc="bottom")
    elm.MeterA().down().toy(s.start).label("the meter,\nin series", loc="bottom")
    elm.Line().left().tox(s.start)
    elm.Ground().at(s.start)


def _rc_glow(d, rlabel, clabel):
    s = elm.SourceV().up().label("5 V", loc="bottom")
    elm.Line().right(d.unit * 0.4)
    elm.Button().right().label("SW1")
    n = elm.Dot()
    elm.Capacitor(polar=True).at(n.center).down().toy(s.start).label(clabel, loc="bottom")
    elm.Dot()
    elm.Line().at(n.center).right(d.unit * 0.6)
    elm.Resistor().right().label(rlabel)
    elm.LED().down().toy(s.start).label("LED1", loc="bottom")
    elm.Line().left().tox(s.start)
    elm.Ground().at(s.start)


def afterglow(d):
    _rc_glow(d, "R1\n330 Ω", "C1\n1000 µF")


def rctime(d):
    _rc_glow(d, "R1\n(pick one)", "C1\n(pick one)")


def _ic555(d, top, bottom, left=(), right=(), lbl="U1\n555"):
    names = {"1": "GND", "2": "TRIG", "3": "OUT", "4": "RST", "5": "CTRL", "6": "THR", "7": "DIS", "8": "VCC"}
    pins = ([elm.IcPin(name=names[p], pin=p, side="top", anchorname="p" + p) for p in top]
            + [elm.IcPin(name=names[p], pin=p, side="bottom", anchorname="p" + p) for p in bottom]
            + [elm.IcPin(name=names[p], pin=p, side="left", anchorname="p" + p) for p in reversed(left)]
            + [elm.IcPin(name=names[p], pin=p, side="right", anchorname="p" + p) for p in reversed(right)])
    return d.add(elm.Ic(pins=pins, pinspacing=1.25, edgepadW=0.7, edgepadH=0.9, leadlen=0.7, label=lbl, lblsize=13))


def _flag(d, at, up=0.6):
    elm.Line().at(at).up(up)
    elm.Vdd().label("+5 V")


def _gnd(d, at, down=0.5):
    elm.Line().at(at).down(down)
    elm.Ground()


def _out_led(d, u, rlabel="R3\n330 Ω"):
    elm.Line().at(u.p3).down(0.4)
    elm.Resistor().down().label(rlabel, loc="bottom")
    elm.LED().down().label("LED1", loc="bottom")
    elm.Ground()


def _input(d, u, pin, side, name):
    """A 555 input with a 10k pull-up to +5 V and a button to ground, the button beside the chip."""
    a = getattr(u, "p" + pin)
    elm.Line().at(a).up(0.9)
    n = elm.Dot()
    elm.Resistor().at(n.center).up().label(f"10 kΩ\npull-up", loc="bottom" if side > 0 else "top")   # label on the outside
    elm.Vdd().label("+5 V")
    elm.Line().at(n.center).right(side * 2.6) if side > 0 else elm.Line().at(n.center).left(2.6)
    elm.Button().down().label(name, loc="bottom" if side > 0 else "top")
    elm.Line().down().toy(u.p1[1] - 0.6)
    elm.Ground()


def chip(d):
    u = _ic555(d, top=["8", "4"], bottom=["1", "2", "6", "3"], left=["7", "5"])
    _flag(d, u.p8); _flag(d, u.p4)
    _gnd(d, u.p1); _gnd(d, u.p2); _gnd(d, u.p6)
    _out_led(d, u)
    for p in ("p7", "p5"):
        elm.Line().at(getattr(u, p)).left(0.3); elm.Label().label("n/c", loc="left", fontsize=10)


def latch(d):
    u = _ic555(d, top=["4", "8", "2"], bottom=["1", "6", "3"], right=["7", "5"])
    _flag(d, u.p8)
    _input(d, u, "4", -1, "RESET")
    _input(d, u, "2", +1, "SET")
    _gnd(d, u.p1); _gnd(d, u.p6)
    _out_led(d, u)
    for p in ("p7", "p5"):
        elm.Line().at(getattr(u, p)).right(0.3); elm.Label().label("n/c", loc="right", fontsize=10)


def oneshot(d):
    u = _ic555(d, top=["8", "4", "2"], bottom=["7", "6", "1", "3"], right=["5"])
    _flag(d, u.p8); _flag(d, u.p4)
    _input(d, u, "2", +1, "SW1")
    # the timing network under the chip: pins 7 and 6 joined, R1 up to +5 V on the left, C1 down to ground
    elm.Line().at(u.p7).down(0.6); j = elm.Dot()
    elm.Line().at(u.p6).down(0.6); k = elm.Dot()
    elm.Line().at(j.center).to(k.center)
    elm.Line().at(j.center).left(1.6)
    elm.Resistor().up().label("R1\n100 kΩ", loc="top")
    elm.Vdd().label("+5 V")
    elm.Capacitor(polar=True).at(k.center).down().label("C1\n10 µF", loc="bottom")
    elm.Ground()
    _gnd(d, u.p1)
    _out_led(d, u)
    elm.Line().at(u.p5).right(0.3); elm.Label().label("n/c", loc="right", fontsize=10)


def blink(d):
    u = d.add(elm.Ic(pins=[elm.IcPin(name="TRIG", pin="2", side="left", anchorname="TRIG"),
                     elm.IcPin(name="THR", pin="6", side="left", anchorname="THR"),
                     elm.IcPin(name="DIS", pin="7", side="left", anchorname="DIS"),
                     elm.IcPin(name="OUT", pin="3", side="right", anchorname="OUT"),
                     elm.IcPin(name="RST", pin="4", side="top", anchorname="RST"),
                     elm.IcPin(name="VCC", pin="8", side="top", anchorname="VCC"),
                     elm.IcPin(name="CTRL", pin="5", side="bottom", anchorname="CTRL"),
                     elm.IcPin(name="GND", pin="1", side="bottom", anchorname="GND")],
               pinspacing=1.2, edgepadW=1.2, edgepadH=0.8, leadlen=0.8, label="U1\n555", lblsize=13))   # d.add places it now, so its pin anchors exist
    # supply rail across the top
    top = u.VCC[1] + 1.2
    elm.Line().at(u.VCC).toy(top)
    elm.Line().at(u.RST).toy(top)
    x0 = u.DIS[0] - 2.4
    elm.Line().at((x0, top)).tox(u.VCC[0] + 1.0)
    elm.Vdd().at((u.VCC[0] + 1.0, top)).label("+5 V")
    elm.Dot().at((u.VCC[0], top)); elm.Dot().at((u.RST[0], top))
    # R1 from the rail down to DIS, R2 down to THR/TRIG, C1 to ground
    elm.Resistor().at((x0, top)).down().toy(u.DIS[1]).label("R1\n10 kΩ", loc="top")
    elm.Line().at(u.DIS).tox(x0); elm.Dot().at((x0, u.DIS[1]))
    elm.Resistor().at((x0, u.DIS[1])).down().toy(u.THR[1]).label("R2\n68 kΩ", loc="top")
    elm.Line().at(u.THR).tox(x0); elm.Dot().at((x0, u.THR[1]))
    elm.Line().at((x0, u.THR[1])).toy(u.TRIG[1])
    elm.Line().at(u.TRIG).tox(x0); elm.Dot().at((x0, u.TRIG[1]))
    bot = u.GND[1] - 1.6
    elm.Capacitor(polar=True).at((x0, u.TRIG[1])).down().toy(bot).label("C1\n10 µF", loc="top")
    elm.Line().at((x0, bot)).tox(u.OUT[0] + 3.4)
    elm.Line().at(u.GND).toy(bot); elm.Dot().at((u.GND[0], bot))
    elm.Ground().at((u.GND[0], bot))
    elm.Label().at((u.CTRL[0], u.CTRL[1] - 0.35)).label("n/c", fontsize=10)
    # output: R3 and the LED down to the ground rail
    elm.Line().at(u.OUT).right(1.0)
    elm.Resistor().right().label("R3\n330 Ω")
    elm.LED().down().toy(bot).label("LED1", loc="bottom")
    elm.Dot()


def sym(name, draw):
    save("sym_" + name, draw, unit=2.0, fontsize=12)


if __name__ == "__main__":
    OUT = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    for f in (light, series, button, dimmer, blink, divider, ammeter, afterglow, rctime, chip, latch, oneshot):
        save(f.__name__, f)
    sym("led", lambda d: (elm.LED().right().label("A      K", loc="bottom", fontsize=10)))
    sym("resistor", lambda d: elm.Resistor().right())
    sym("button", lambda d: elm.Button().right())
    sym("pot", lambda d: elm.Potentiometer().right().label("1     3", loc="bottom", fontsize=10))
    sym("electrolytic", lambda d: elm.Capacitor(polar=True).right())
    sym("capacitor", lambda d: elm.Capacitor().right())
    sym("diode", lambda d: elm.Diode().right())
    # as it sits on the breadboard: notch left, pins 1-4 along the bottom, 8-5 back along the top
    sym("ne555", lambda d: elm.Ic(pins=[elm.IcPin(pin=str(i), side="bottom") for i in (1, 2, 3, 4)]
                                   + [elm.IcPin(pin=str(i), side="top") for i in (8, 7, 6, 5)],
                                   pinspacing=0.8, edgepadW=0.4, edgepadH=0.5, label="555\n◖ notch", leadlen=0.5))
    sym("meter", lambda d: elm.MeterV().right())
    sym("ammeter", lambda d: elm.MeterA().right())
