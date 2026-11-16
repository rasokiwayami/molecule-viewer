"""Generate C60 (PubChem has no 3D conformer for it) and add it to the bundled data.

Usage: python3 scripts/make_fullerene.py   (run after fetch_molecules.py)
"""
import itertools
import json
import math
import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "data"
PHI = (1 + math.sqrt(5)) / 2
BOND = 1.43  # mean C-C length in angstrom


def vertices():
    bases = [(0, 1, 3 * PHI), (1, 2 + PHI, 2 * PHI), (PHI, 2, 2 * PHI + 1)]
    points = set()
    for base in bases:
        for signs in itertools.product((1, -1), repeat=3):
            p = tuple(s * v for s, v in zip(signs, base))
            for shift in range(3):  # cyclic permutations only
                points.add(tuple(round(p[(i + shift) % 3], 6) for i in range(3)))
    return sorted(points)


def main():
    pts = vertices()
    assert len(pts) == 60
    edges = [
        (a, b)
        for a, b in itertools.combinations(range(60), 2)
        if abs(math.dist(pts[a], pts[b]) - 2) < 1e-3
    ]
    assert len(edges) == 90
    nbrs = {i: set() for i in range(60)}
    for a, b in edges:
        nbrs[a].add(b)
        nbrs[b].add(a)

    def in_pentagon(a, b):
        # a-x-y-b with x,y distinct from a,b closes a 5-ring when x and y share a neighbour
        for x in nbrs[a] - {b}:
            for y in nbrs[b] - {a}:
                if (nbrs[x] & nbrs[y]) - {a, b}:
                    return True
        return False

    scale = BOND / 2
    lines = ["fullerene", "  generated: truncated icosahedron", ""]
    lines.append(f"{60:3d}{90:3d}  0     0  0  0  0  0  0999 V2000")
    for x, y, z in pts:
        lines.append(f"{x*scale:10.4f}{y*scale:10.4f}{z*scale:10.4f} C   0  0  0  0  0  0  0  0  0  0  0  0")
    doubles = 0
    for a, b in edges:
        order = 1 if in_pentagon(a, b) else 2
        doubles += order == 2
        lines.append(f"{a+1:3d}{b+1:3d}{order:3d}  0  0  0  0")
    assert doubles == 30, doubles
    lines += ["M  END", "$$$$", ""]
    (OUT / "fullerene.sdf").write_text("\n".join(lines))

    index_path = OUT / "index.json"
    index = [m for m in json.loads(index_path.read_text()) if m["id"] != "fullerene"]
    index.append({"id": "fullerene", "ja": "フラーレンC60", "en": "buckminsterfullerene",
                  "cid": 123591, "formula": "C60", "weight": 720.66, "generated": True})
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1))
    print("fullerene ok, double bonds:", doubles)


if __name__ == "__main__":
    main()
