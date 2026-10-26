# Fill the see-through pixels of UI pictures with the colour of the nearest visible pixels
# (alpha unchanged). Exported art keeps black (0,0,0) under transparent pixels; the GPU blends
# neighbouring texels (linear filtering, mipmaps), so that black leaks into every edge and draws a
# dark, jagged ring around coins, boosters, the gear… With the edge colour bled outwards the
# outline stays clean at any size. Safe to run again.
#   tools/.venv: python3 -m venv tools/.venv && tools/.venv/bin/pip install numpy pillow
#   tools/.venv/bin/python tools/art/fix-alpha-edges.py assets/resources/uiart
import sys, pathlib
import numpy as np
from PIL import Image, ImageFilter

def bleed(im: Image.Image) -> Image.Image:
    a = np.asarray(im, dtype=np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3:]
    hole = alpha[..., 0] <= 0.0
    if not hole.any() or hole.all():
        return im
    out = rgb.copy()
    known = ~hole
    pre = rgb * alpha                       # premultiplied colour, averaged by coverage
    for radius in (1, 2, 4, 8, 16, 32, 64):
        if known.all():
            break
        k = Image.fromarray((alpha[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(radius))
        w = np.asarray(k, dtype=np.float32) / 255.0
        p = np.stack([np.asarray(Image.fromarray(np.clip(pre[..., i] * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(radius)), dtype=np.float32) / 255.0 for i in range(3)], -1)
        fill = (~known) & (w > 1e-3)
        out[fill] = np.clip(p[fill] / w[fill][:, None], 0, 1)
        known |= fill
    res = np.concatenate([out, alpha], -1)
    return Image.fromarray(np.round(res * 255).astype(np.uint8), 'RGBA')

def main(root: str):
    n = 0
    for f in sorted(pathlib.Path(root).rglob('*')):
        if f.suffix.lower() not in ('.webp', '.png'):
            continue
        im = Image.open(f)
        if im.mode not in ('RGBA', 'LA', 'P'):
            continue
        im = im.convert('RGBA')
        out = bleed(im)
        if out is im:
            continue
        if f.suffix.lower() == '.webp':
            out.save(f, 'WEBP', quality=92, exact=True)     # exact: keep the colour under alpha 0
        else:
            out.save(f, 'PNG', optimize=True)
        n += 1
        print('fixed', f)
    print(n, 'pictures')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/resources/uiart')
