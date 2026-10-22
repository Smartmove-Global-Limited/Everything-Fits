#!/usr/bin/env python3
"""Remove the print grain from inside bag frame images (the layer drawn OVER the items).

Most container frames (<id>-frame.png) carry a speckled paper texture over the whole bag, the
inner area included. Drawn above the packed items it makes them look broken / noisy (level 8,
ctr12). Inside the bag's inner polygon (<id>.json "inner") only big solid shapes are kept (printed
dividers: spokes, spiral...); the specks are made transparent. The rim outside the polygon is
untouched. Safe to run again (a cleaned image stays the same).

  python3 tools/clean-bag-frames.py            all bags in assets/gamecontent/content
Run after tools/sync-content.mjs (it copies the original images from the web repo).
Needs Pillow only.
"""
import glob
import json
import os
import sys
from collections import deque

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SOLID = 128          # alpha from which a pixel counts as part of a shape
MIN_SHAPE = 1500     # pixels: smaller solid blobs inside the bag are grain
EDGE_KEEP = 3        # pixels of anti-aliasing kept around the shapes that stay


def clean(json_path, frame_path):
    meta = json.load(open(json_path))
    inner, rect = meta.get('inner'), meta.get('image')
    if not inner or not rect:
        return None
    im = Image.open(frame_path).convert('RGBA')
    w, h = im.size
    kx, ky = w / rect['w'], h / rect['h']
    poly = [((x - rect['x']) * kx, (y - rect['y']) * ky) for x, y in inner]
    inside = Image.new('L', (w, h), 0)
    ImageDraw.Draw(inside).polygon(poly, fill=255)
    inside = inside.filter(ImageFilter.MinFilter(5))    # stay 2 px clear of the rim

    alpha = im.getchannel('A')
    a, ins = alpha.load(), inside.load()
    x0, y0, x1, y1 = inside.getbbox() or (0, 0, 0, 0)
    seen = bytearray(w * h)
    keep = Image.new('L', (w, h), 0)
    kp = keep.load()
    for sy in range(y0, y1):
        for sx in range(x0, x1):
            i = sy * w + sx
            if seen[i] or not ins[sx, sy] or a[sx, sy] < SOLID:
                continue
            blob, q = [], deque([(sx, sy)])
            seen[i] = 1
            while q:
                x, y = q.popleft()
                blob.append((x, y))
                for nx in (x - 1, x, x + 1):
                    for ny in (y - 1, y, y + 1):
                        if 0 <= nx < w and 0 <= ny < h:
                            j = ny * w + nx
                            if not seen[j] and a[nx, ny] >= SOLID:
                                seen[j] = 1
                                q.append((nx, ny))
            if len(blob) >= MIN_SHAPE:
                for x, y in blob:
                    kp[x, y] = 255
    keep = keep.filter(ImageFilter.MaxFilter(EDGE_KEEP * 2 + 1))
    kp = keep.load()
    removed = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            if ins[x, y] and a[x, y] and not kp[x, y]:
                a[x, y] = 0
                removed += 1
    if removed:
        im.putalpha(alpha)
        im.save(frame_path, optimize=True)
    return removed


def main():
    base = os.path.join(ROOT, 'assets/gamecontent/content')
    total = 0
    for frame in sorted(glob.glob(os.path.join(base, '**/bags/*-frame.png'), recursive=True)):
        js = frame.replace('-frame.png', '.json')
        if not os.path.exists(js):
            continue
        n = clean(js, frame)
        if n:
            total += 1
            print(f'{os.path.basename(frame)}: {n} grain pixels removed')
    print(f'done: {total} frames cleaned')


if __name__ == '__main__':
    sys.exit(main())
