"""Generates src/MDReader/Assets/app.ico (rounded tile with a Markdown 'M' + down arrow)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
# vertical gradient tile
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
top, bot = (79, 110, 247), (45, 55, 170)
for y in range(S):
    t = y / (S - 1)
    gd.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([40, 40, S - 40, S - 40], radius=210, fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)
w = (255, 255, 255, 255)
# "M" as polygon
x0, x1, y0, y1, st = 190, 600, 330, 700, 80
d.polygon([(x0, y1), (x0, y0), (x0 + st, y0), ((x0 + x1) / 2, y0 + 190), (x1 - st, y0), (x1, y0), (x1, y1),
           (x1 - st, y1), (x1 - st, y0 + 150), ((x0 + x1) / 2, y0 + 330), (x0 + st, y0 + 150), (x0 + st, y1)], fill=w)
# down arrow
ax = 745
d.rectangle([ax - 40, y0, ax + 40, y1 - 140], fill=w)
d.polygon([(ax - 120, y1 - 170), (ax + 120, y1 - 170), (ax, y1)], fill=w)

out = Path(sys.argv[1])
img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.resize((256, 256), Image.LANCZOS).save(out.with_suffix(".png"))
print("wrote", out)
