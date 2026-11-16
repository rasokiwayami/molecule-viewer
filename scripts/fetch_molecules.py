"""Download bundled 3D structures and basic properties from PubChem.

Usage: python3 scripts/fetch_molecules.py
Writes public/data/<id>.sdf and public/data/index.json.
"""
import json
import pathlib
import time
import urllib.parse
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "data"
BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound"

# (id, Japanese name, PubChem query name)
MOLECULES = [
    ("caffeine", "カフェイン", "caffeine"),
    ("aspirin", "アスピリン", "aspirin"),
    ("ethanol", "エタノール", "ethanol"),
    ("glucose", "グルコース", "D-glucose"),
    ("capsaicin", "カプサイシン", "capsaicin"),
    ("penicillin-g", "ペニシリンG", "penicillin G"),
    ("atp", "ATP", "adenosine triphosphate"),
    ("vitamin-c", "ビタミンC", "ascorbic acid"),
    ("nicotine", "ニコチン", "nicotine"),
    ("dopamine", "ドーパミン", "dopamine"),
    ("serotonin", "セロトニン", "serotonin"),
    ("adrenaline", "アドレナリン", "epinephrine"),
    ("menthol", "メントール", "menthol"),
    ("vanillin", "バニリン", "vanillin"),
    ("limonene", "リモネン", "limonene"),
    ("ibuprofen", "イブプロフェン", "ibuprofen"),
    ("acetaminophen", "アセトアミノフェン", "acetaminophen"),
    ("cholesterol", "コレステロール", "cholesterol"),
    ("testosterone", "テストステロン", "testosterone"),
    ("sucrose", "スクロース", "sucrose"),
    ("citric-acid", "クエン酸", "citric acid"),
    ("urea", "尿素", "urea"),
    ("benzene", "ベンゼン", "benzene"),
    ("water", "水", "water"),
    ("carbon-dioxide", "二酸化炭素", "carbon dioxide"),
    ("methane", "メタン", "methane"),
    ("ammonia", "アンモニア", "ammonia"),
    ("glutamic-acid", "グルタミン酸", "L-glutamic acid"),
    ("theobromine", "テオブロミン", "theobromine"),
    ("oseltamivir", "オセルタミビル", "oseltamivir"),
    ("adenine", "アデニン", "adenine"),
    ("naphthalene", "ナフタレン", "naphthalene"),
    ("indigo", "インジゴ", "indigo"),
    ("beta-carotene", "β-カロテン", "beta-carotene"),
    ("fullerene", "フラーレンC60", "buckminsterfullerene"),
    ("acetic-acid", "酢酸", "acetic acid"),
    ("lactic-acid", "乳酸", "lactic acid"),
    ("geosmin", "ゲオスミン", "geosmin"),
    ("luciferin", "ルシフェリン", "firefly luciferin"),
    ("melatonin", "メラトニン", "melatonin"),
]


def get(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode()


def main():
    index, missing = [], []
    for mol_id, ja, query in MOLECULES:
        name = urllib.parse.quote(query)
        try:
            sdf = get(f"{BASE}/name/{name}/SDF?record_type=3d")
            props = json.loads(
                get(f"{BASE}/name/{name}/property/MolecularFormula,MolecularWeight/JSON")
            )["PropertyTable"]["Properties"][0]
        except Exception as error:  # noqa: BLE001 - report and continue
            missing.append((mol_id, str(error)))
            continue
        (OUT / f"{mol_id}.sdf").write_text(sdf)
        index.append(
            {
                "id": mol_id,
                "ja": ja,
                "en": query,
                "cid": props["CID"],
                "formula": props["MolecularFormula"],
                "weight": float(props["MolecularWeight"]),
            }
        )
        time.sleep(0.4)
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
    print(f"ok {len(index)} / missing {missing}")


if __name__ == "__main__":
    main()
