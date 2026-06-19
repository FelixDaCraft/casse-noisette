#!/usr/bin/env python3
"""
Génère le site casse-noisette à partir de la Google My Map (export KML).

Tourne sur le homelab (aucune dépendance externe, stdlib uniquement).
  - télécharge le KML de la carte
  - extrait les itinéraires (calques) et leurs panneaux (points)
  - injecte les données dans template.html -> site/index.html

nginx sert le dossier site/ en direct : aucun redémarrage nécessaire.
Lancé périodiquement par cron pour rester synchro avec la carte.
"""
import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET

MID = "1RQF8jQgwfrAmCjlpRn4N_zUY-3LiDzc"
INVENTORY_LAYER = "Panneaux d'affichage libre"  # calque exclu des boutons
NS = "{http://www.opengis.net/kml/2.2}"

BASE = os.path.dirname(os.path.abspath(__file__))
KML_URL = f"https://www.google.com/maps/d/kml?mid={MID}&forcekml=1"


def download_kml(dest):
    req = urllib.request.Request(KML_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    with open(dest, "wb") as f:
        f.write(data)
    return data


def parse(kml_bytes):
    root = ET.fromstring(kml_bytes)
    layers = []
    for folder in root.iter(f"{NS}Folder"):
        name_el = folder.find(f"{NS}name")
        fname = (name_el.text or "").strip() if name_el is not None else ""
        points = []
        for pm in folder.findall(f"{NS}Placemark"):
            pt = pm.find(f"{NS}Point")
            if pt is None:
                continue
            coord_el = pt.find(f"{NS}coordinates")
            if coord_el is None or not coord_el.text:
                continue
            parts = coord_el.text.strip().split(",")
            lng, lat = parts[0].strip(), parts[1].strip()  # KML = lng,lat -> on inverse
            pnm_el = pm.find(f"{NS}name")
            pnm = (pnm_el.text or "").strip() if pnm_el is not None else ""
            points.append({"name": pnm, "latlng": f"{lat},{lng}"})
        layers.append({"itineraire": fname, "nbPoints": len(points), "points": points})
    return layers


def main():
    kml = download_kml(os.path.join(BASE, "source.kml"))
    layers = parse(kml)

    with open(os.path.join(BASE, "data.json"), "w", encoding="utf-8") as f:
        json.dump(layers, f, ensure_ascii=False, indent=2)

    itins = [
        {"itineraire": l["itineraire"], "points": l["points"]}
        for l in layers
        if l["itineraire"] != INVENTORY_LAYER and l["points"]
    ]
    if not itins:
        sys.exit("ERREUR : aucun itinéraire trouvé dans le KML.")

    data_js = json.dumps(itins, ensure_ascii=False, separators=(",", ":"))

    with open(os.path.join(BASE, "template.html"), encoding="utf-8") as f:
        html = f.read()
    html = html.replace("__DATA__", data_js)

    site_dir = os.path.join(BASE, "site")
    os.makedirs(site_dir, exist_ok=True)
    with open(os.path.join(site_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

    total = sum(len(i["points"]) for i in itins)
    print(f"OK : {len(itins)} itinéraires, {total} panneaux -> site/index.html")


if __name__ == "__main__":
    main()
