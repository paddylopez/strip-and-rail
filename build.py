#!/usr/bin/env python3
"""Build Strip & Rail into one self-contained page.

    ./build.py            run the tests, draw the schematics (Schemdraw), inline CSS/JS/data/SVGs, and write:
                            dist/strip-and-rail.html   the standalone page: open it from disk, or serve it anywhere
                            build/embed.html           the same page without <!doctype>/<head>, for hosts that wrap it
    node --test test/     the tests on their own

The page's only runtime dependency is Google Fonts, with fallbacks, so it works offline."""
import base64, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, "src"), os.path.join(HERE, "dist", "strip-and-rail.html")
SCH = os.path.join(HERE, "schematics", "out")


def main():
    t = subprocess.run(["node", "--test", "test/"], cwd=HERE, capture_output=True, text=True)
    summary = [l for l in t.stdout.splitlines() if l.startswith(("# pass", "# fail"))]
    if t.returncode != 0:
        sys.exit("  !! engine tests failed:\n" + t.stdout[-3000:])
    print("  tests:", ", ".join(s[2:] for s in summary))
    subprocess.run([sys.executable, os.path.join(HERE, "schematics", "draw.py"), SCH], check=True)
    subprocess.run([sys.executable, os.path.join(HERE, "examples", "draw.py")], check=True, capture_output=True)
    sch = {}
    for f in sorted(os.listdir(SCH)):
        if f.endswith(".svg"):
            data = open(os.path.join(SCH, f), "rb").read()
            if b"<svg" not in data[:400]:
                sys.exit(f"  !! {f} is not an SVG")
            sch[f[:-4]] = "data:image/svg+xml;base64," + base64.b64encode(data).decode()
    EXD = os.path.join(HERE, "examples")
    for d in sorted(os.listdir(EXD)):
        f = os.path.join(EXD, d, "schematic.svg")
        if os.path.isfile(f):
            data = open(f, "rb").read()
            if b"<svg" not in data[:400]:
                sys.exit(f"  !! examples/{d}/schematic.svg is not an SVG")
            sch["ex-" + d] = "data:image/svg+xml;base64," + base64.b64encode(data).decode()
    data = subprocess.run(["node", os.path.join(HERE, "tools", "bundle.js")], capture_output=True, text=True)
    if data.returncode != 0 or not data.stdout.startswith("{"):
        sys.exit("  !! data bundle failed:\n" + data.stderr[-2000:])
    page = open(os.path.join(SRC, "page.html")).read()
    parts = {"/*{{CSS}}*/": open(os.path.join(SRC, "style.css")).read(),
             "/*{{ENGINE}}*/": open(os.path.join(SRC, "engine.js")).read(),
             "/*{{LEVELS}}*/": open(os.path.join(SRC, "levels.js")).read(),
             "/*{{DATA}}*/": data.stdout,
             "/*{{DATALOADER}}*/": open(os.path.join(SRC, "data.js")).read(),
             "/*{{YAML}}*/": open(os.path.join(HERE, "vendor", "js-yaml.min.js")).read(),
             "/*{{CIRCUIT}}*/": open(os.path.join(SRC, "circuit.js")).read(),
             "/*{{KICAD}}*/": open(os.path.join(SRC, "kicad.js")).read(),
             "/*{{CARDS}}*/": open(os.path.join(SRC, "cards.js")).read(),
             "/*{{CALC}}*/": open(os.path.join(SRC, "calc.js")).read(),
             "/*{{RULES}}*/": open(os.path.join(SRC, "rules.js")).read(),
             "/*{{SCHEMATICS}}*/": json.dumps(sch),
             "/*{{UI}}*/": open(os.path.join(SRC, "ui.js")).read()}
    for k, v in parts.items():
        if page.count(k) != 1:
            sys.exit(f"  !! placeholder {k} missing from page.html")
        if "</script" in v.lower():
            sys.exit(f"  !! {k} contains </script, which would end the inline block early")
        page = page.replace(k, v)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n')
    open(OUT, "w", encoding="utf-8").write(head + page + "</html>\n")      # head elements, then the first <div> opens <body>
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    open(os.path.join(HERE, "build", "embed.html"), "w", encoding="utf-8").write(page)
    print(f"  wrote {os.path.relpath(OUT, HERE)} ({len(page):,} bytes, {len(sch)} drawings)")


if __name__ == "__main__":
    main()
