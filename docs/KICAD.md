# KiCad netlists → levels

Draw the schematic in KiCad, export its netlist, and drop the `.net` file on the game (or **Import a circuit…**).
It becomes a level: the bin holds your parts by their KiCad designators, and Check compares your breadboard with
KiCad's nets. Or convert on the command line and edit the result:

```
node tools/kicad2circuit.js project.net > circuit.yaml      # notes on stderr; exit 1 if something needs you
```

## Exporting the netlist

- **KiCad 6, 7, 8, 9:** Eeschema → *File → Export → Netlist…*, format **KiCad**. Or: `kicad-cli sch export netlist -o project.net project.kicad_sch`
- **KiCad 5:** Eeschema → *Tools → Generate Netlist File…*, the **Pcbnew** tab.

Both formats work (KiCad 5 writes "version D", KiCad 6+ "version E").

## What happens to your schematic

- **Parts** are recognised by their library symbol (`Device:LED`, `Timer:NE555P`), never by designator letters:
  an LED called D1 is still an LED. The map is [`data/kicad.json`](../data/kicad.json):

| KiCad symbols | Becomes | Pins |
|---|---|---|
| `Device:R`, `Device:R_Small`, `Device:R_US`, `Device:R_Small_US` | `resistor` | same numbers |
| `Device:C`, `Device:C_Small` | `capacitor` | same numbers |
| `Device:C_Polarized`, `Device:C_Polarized_Small`, `Device:CP`, `Device:CP1`, `Device:CP_Small`, `Device:C_Polarized_US` | `electrolytic` | 1 → +, 2 → - |
| `Device:LED`, `Device:LED_Small`, `Device:LED_ALT`, `LED:*` | `led` | 1 → K, 2 → A |
| `Device:D`, `Device:D_Small`, `Diode:1N4148`, `Diode:1N914`, `Diode:1N4148W` | `diode` | 1 → K, 2 → A |
| `Diode:1N400*` | `diode` | 1 → K, 2 → A |
| `Device:R_Potentiometer`, `Device:R_Potentiometer_Trim`, `Device:R_POT`, `Device:R_POT_TRIM`, `Device:R_Potentiometer_US` | `pot` | 1 → 1, 2 → W, 3 → 3 |
| `Switch:SW_Push`, `Switch:SW_SPST`, `Switch:SW_Push_Open` | `button` | same numbers |
| `Timer:NE555*`, `Timer:LM555*`, `Timer:NA555*`, `Timer:SE555*` | `ne555` | same numbers |
| `Timer:TLC555*`, `Timer:ICM7555*` | `ne555` | same numbers |
| `Comparator:LM393*` | `lm393` | same numbers |
| `Comparator:LM2903*` | `lm393` | same numbers |
| `Device:Battery`, `Device:Battery_Cell` | the bench supply | 1 → +, 2 → - |

  A netlist's own pin names (`pinfunction`: K, A, +, −) win when they name a pin directly.
- **Values** are read the way KiCad writes them: `330`, `10K`, `4K7`, `4R7`, `10uF`, `0.1uF`, `100n`.
  An LED's colour comes from its value (`Red`, `LED_Green`); if it doesn't say, it's red, and the file says so.
- **The supply:** a `Device:Battery` or `Battery_Cell` symbol is the bench supply (its value, like `9V`, sets the
  voltage). Without one, power nets are: `+5V`, `+3V3`, `VCC`… become `PSU.+` (at the voltage in the name),
  and `GND` becomes `PSU.-`. The game has one supply, so a second positive rail stays an ordinary net.
- **Nets** keep their KiCad names when they're real names (`GND`, `+5V`, `/TRIG`); auto-names like
  `Net-(D1-Pad2)` become `N3`, with the KiCad name kept as a comment. A pin wired to nothing is in no net,
  so the check keeps it free.
- **Winning** defaults to *wiring matches the netlist*. Add behaviour goals by hand: see [CIRCUITS.md](CIRCUITS.md).

## When something can't be mapped

Nothing is guessed. A symbol with no game part yet (a transistor, a 4017, a microcontroller board) is **left out**,
its pins come out of the nets, and the result says so: in the game you get the converted file in an editor, with
the notes above it, to fix and load in place; on the command line the notes are `# NOTE:` lines and the exit code
is 1. A resistor whose value it can't read is written as `value: TODO`, which won't load until you fill it in.

**Adding a mapping** for a symbol is one line in `data/kicad.json`; a symbol for a part the game doesn't have
yet needs the part first ([DATA.md](DATA.md)). The tests (`test/kicad.test.js`) convert a KiCad 5 and a KiCad 6+
netlist and build each on the virtual breadboard.
