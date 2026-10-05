"""Render exact exported C Nano sample STLs, with/without the reference key."""
import json
import struct
import sys
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / (sys.argv[1] if len(sys.argv) > 1 else 'artifacts/c-nano-pry-samples')
REFINED = 'refinements' in str(OUT)


def mesh(path):
    data = path.read_bytes()
    return np.array([struct.unpack_from('<9f', data, 96 + 50 * i)
                     for i in range(struct.unpack_from('<I', data, 80)[0])]).reshape(-1, 3, 3)


def font(size):
    return ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', size)


def render(objects, width=420, height=345):
    image = np.full((height, width, 3), (242, 246, 249), dtype=np.uint8)
    depth = np.full((height, width), -np.inf)
    camera = np.array([.38, -.57 if REFINED else .57, .73]); camera /= np.linalg.norm(camera)
    u = np.cross([0, 0, 1], camera); u /= np.linalg.norm(u)
    up = np.cross(camera, u)
    matrix = np.array([u, up, camera])
    light = np.array([-.1, .4, 1.]); light /= np.linalg.norm(light)
    scale = 6.35
    for faces, color in objects:
        projected = (faces - [0, 0, 4.3]) @ matrix.T
        for tri, p in zip(faces, projected):
            normal = np.cross(tri[1] - tri[0], tri[2] - tri[0])
            normal /= np.linalg.norm(normal) or 1
            if normal @ camera <= 0:
                continue
            x = width / 2 + scale * p[:, 0]; y = height / 2 - scale * p[:, 1]
            left, right = max(0, int(np.floor(x.min()))), min(width - 1, int(np.ceil(x.max())))
            top, bottom = max(0, int(np.floor(y.min()))), min(height - 1, int(np.ceil(y.max())))
            if right < left or bottom < top:
                continue
            xx, yy = np.meshgrid(np.arange(left, right + 1) + .5, np.arange(top, bottom + 1) + .5)
            denom = (y[1]-y[2])*(x[0]-x[2])+(x[2]-x[1])*(y[0]-y[2])
            if abs(denom) < 1e-9:
                continue
            a = ((y[1]-y[2])*(xx-x[2])+(x[2]-x[1])*(yy-y[2]))/denom
            b = ((y[2]-y[0])*(xx-x[2])+(x[0]-x[2])*(yy-y[2]))/denom
            c = 1-a-b
            z = a*p[0,2]+b*p[1,2]+c*p[2,2]
            crop = depth[top:bottom+1, left:right+1]
            mask = (a >= 0) & (b >= 0) & (c >= 0) & (z > crop)
            crop[mask] = z[mask]
            shade = .48 + .52 * max(0, normal @ light)
            image[top:bottom+1, left:right+1][mask] = [int(min(255, v*shade)) for v in color]
    return Image.fromarray(image)


manifest = json.loads((OUT / 'manifest.json').read_text())
variants = manifest.get('variants', manifest.get('samples'))
if REFINED:
    variants = [{'id': '07', 'name': 'Original large bowl', 'original': True,
                 'stl': str(ROOT / 'artifacts/c-nano-pry-samples/c-nano-pry-07.stl'),
                 'keyPosition': [0, -5.05, 5.5]}, *variants]
key = [(mesh(ROOT / f'public/keys/CN-{part}.stl'), color) for part, color in
       [('body', (48, 54, 61)), ('connector', (195, 207, 220)), ('touch', (231, 189, 98))]]
for seated, angle in ([(False, 0), (True, 0), (True, 20)] if REFINED else [(False, 0), (True, 0)]):
    columns = 3 if REFINED else 5
    rows = math.ceil(len(variants) / columns)
    total_height = 120 + rows * 421 + 68
    image = Image.new('RGB', (columns * 444 + 20, total_height), '#ffffff')
    draw = ImageDraw.Draw(image)
    draw.text((35, 24), 'Option 7 · five compact 20° pry clearances' if REFINED else 'C Nano · 10 finger-access experiments', fill='#182d42', font=font(35))
    subtitle = 'Reference key tilted 20° without lifting' if angle else 'Seated reference keys' if seated else 'Exact printable pocket geometry'
    draw.text((35, 72), subtitle, fill='#466078', font=font(22))
    for i, v in enumerate(variants):
        path = v.get('stlFile', v.get('stl', f'{v["id"]}.stl'))
        faces = mesh(OUT / path)
        objects = [(faces, (135, 158, 180) if v.get('original') else (50, 125, 227))]
        if seated:
            offset = np.array(v.get('keyPosition', [0, -5.05, 5.5 + v.get('raiseMm', 0)]))
            radians = math.radians(angle)
            rotation = np.array([[1, 0, 0], [0, math.cos(radians), -math.sin(radians)], [0, math.sin(radians), math.cos(radians)]])
            pivot = offset - [0, 0, 3.5]
            objects += [((m + [0, 0, 3.5]) @ rotation.T + pivot, color) for m, color in key]
        x = 20 + (i % columns) * 444; y = 120 + (i // columns) * 421
        image.paste(render(objects), (x, y))
        title = v['id'] + ' · ' + ('Compact 20° pry' if REFINED and not v.get('original') else v['name'])
        if len(title) > 30:
            title = title[:29] + '…'
        draw.text((x + 12, y + 350), title, fill='#182d42', font=font(21))
        detail = '17 mm rear bowl · baseline' if v.get('original') else f'{v["clearanceMm"]:.2f} mm working clearance' if REFINED else f'40 × 40 mm · raised {v.get("raiseMm", 0):g} mm'
        draw.text((x + 12, y + 380), detail, fill='#587088', font=font(17))
    draw.text((35, total_height - 43), 'USB-C access is unchanged. Small rear relief follows the key motion.' if REFINED else 'Blue parts print. Reference keys do not. Clearance checks cannot establish finger comfort or grip force.', fill='#526b80', font=font(20))
    path = OUT / ('review-prying.png' if angle else 'review-seated.png' if seated else 'review-empty.png')
    image.save(path)
    print(path)
