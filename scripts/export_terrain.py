"""Bake a small DEM and mapped waterways around the two Shelek turbines."""

import io
import json
import math
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image


LAT, LON = 43.644174, 78.537216
SPAN_LAT, SPAN_LON = 0.024, 0.032
ZOOM, SIZE = 12, 65
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "frontend/src/data/shelek-terrain.json"


def tile_pixel(lat: float, lon: float, zoom: int) -> tuple[float, float]:
    scale = (2**zoom) * 256
    x = (lon + 180) / 360 * scale
    radians = math.radians(lat)
    y = (1 - math.asinh(math.tan(radians)) / math.pi) / 2 * scale
    return x, y


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "OnlyFriendsHackathonTerrain/1.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read()


def elevations(span_lat: float, span_lon: float, zoom: int) -> list[list[float]]:
    images = {}
    result = []
    for row in range(SIZE):
        lat = LAT + span_lat * (0.5 - row / (SIZE - 1))
        line = []
        for column in range(SIZE):
            lon = LON + span_lon * (column / (SIZE - 1) - 0.5)
            x, y = tile_pixel(lat, lon, zoom)
            tx, ty = int(x // 256), int(y // 256)
            if (tx, ty) not in images:
                url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{tx}/{ty}.png"
                images[tx, ty] = Image.open(io.BytesIO(fetch(url))).convert("RGB")
            red, green, blue = images[tx, ty].getpixel((int(x) % 256, int(y) % 256))
            line.append(round(red * 256 + green + blue / 256 - 32768, 2))
        result.append(line)
    return result


def waterways() -> list[list[list[float]]]:
    water_span_lat, water_span_lon = 0.24, 0.32
    west, south = LON - water_span_lon / 2, LAT - water_span_lat / 2
    east, north = LON + water_span_lon / 2, LAT + water_span_lat / 2
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={west},{south},{east},{north}"
    root = ET.fromstring(fetch(url))
    nodes = {node.attrib["id"]: (float(node.attrib["lat"]), float(node.attrib["lon"])) for node in root.findall("node")}
    result = []
    for way in root.findall("way"):
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
        if tags.get("waterway") not in {"river", "stream", "canal"}:
            continue
        points = [nodes[ref.attrib["ref"]] for ref in way.findall("nd") if ref.attrib["ref"] in nodes]
        if len(points) > 1:
            result.append([[round((lon - LON) / water_span_lon, 5), round((lat - LAT) / water_span_lat, 5)] for lat, lon in points])
    return result


def local_tracks() -> list[list[list[float]]]:
    west, south = LON - SPAN_LON / 2, LAT - SPAN_LAT / 2
    east, north = LON + SPAN_LON / 2, LAT + SPAN_LAT / 2
    root = ET.fromstring(fetch(f"https://api.openstreetmap.org/api/0.6/map?bbox={west},{south},{east},{north}"))
    nodes = {node.attrib["id"]: (float(node.attrib["lat"]), float(node.attrib["lon"])) for node in root.findall("node")}
    tracks = []
    for way in root.findall("way"):
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
        if tags.get("highway") not in {"track", "unclassified"}:
            continue
        points = [nodes[ref.attrib["ref"]] for ref in way.findall("nd") if ref.attrib["ref"] in nodes]
        if len(points) > 1:
            tracks.append([[round((lon - LON) / SPAN_LON, 5), round((lat - LAT) / SPAN_LAT, 5)] for lat, lon in points])
    return tracks


def main() -> None:
    heights = elevations(SPAN_LAT, SPAN_LON, ZOOM)
    regional = elevations(0.24, 0.32, 10)
    water = waterways()
    roads = local_tracks()
    data = {"center": [LAT, LON], "span": [SPAN_LAT, SPAN_LON], "heights": heights,
            "regionalSpan": [0.24, 0.32], "regionalHeights": regional, "waterways": water, "roads": roads,
            "sources": ["Mapzen Terrain Tiles / AWS Open Data", "OpenStreetMap contributors"]}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT}: {len(heights)} rows, {len(water)} waterways, {len(roads)} tracks")


if __name__ == "__main__":
    main()
