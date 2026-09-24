"""Render the GLOBE land mask for the Indian seas as a Web-Mercator PNG.

Used as an offline map background (under the tile layer), so coastlines stay
visible when map tiles cannot load. Rows are spaced in Mercator y, so the image
aligns with Leaflet when placed with L.imageOverlay over BOUNDS.

    python scripts/make_land_png.py ../web/public/land-india.png
"""

from __future__ import annotations

import math
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orca.geo.land import is_land  # noqa: E402

LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 4.0, 26.0, 64.0, 96.0
WIDTH = 2400
LAND_RGB = (206, 199, 184)


def merc_y(lat: float) -> float:
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def lat_from_y(y: float) -> float:
    return math.degrees(2 * math.atan(math.exp(y)) - math.pi / 2)


def main(out: Path) -> None:
    y0, y1 = merc_y(LAT_MIN), merc_y(LAT_MAX)
    x_span = math.radians(LON_MAX - LON_MIN)
    height = round(WIDTH * (y1 - y0) / x_span)
    rows = bytearray()
    for r in range(height):
        lat = lat_from_y(y1 - (r + 0.5) / height * (y1 - y0))
        bits = 0
        row = bytearray([0])  # filter byte
        for c in range(WIDTH):
            lon = LON_MIN + (c + 0.5) / WIDTH * (LON_MAX - LON_MIN)
            bits = (bits << 1) | (1 if is_land(lat, lon) else 0)
            if c % 8 == 7:
                row.append(bits)
                bits = 0
        if WIDTH % 8:
            row.append(bits << (8 - WIDTH % 8))
        rows += row

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, height, 1, 3, 0, 0, 0))  # 1-bit palette
    png += chunk(b"PLTE", bytes([0, 0, 0, *LAND_RGB]))
    png += chunk(b"tRNS", bytes([0, 255]))  # index 0 (sea) transparent
    png += chunk(b"IDAT", zlib.compress(bytes(rows), 9))
    png += chunk(b"IEND", b"")
    out.write_bytes(png)
    print(f"wrote {out} ({WIDTH}x{height}, {len(png) / 1024:.0f} KB); bounds [[{LAT_MIN},{LON_MIN}],[{LAT_MAX},{LON_MAX}]]")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "land-india.png"))
