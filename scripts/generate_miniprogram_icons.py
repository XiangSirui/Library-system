"""Generate the small native tab icons. Run from the repository root."""
from pathlib import Path
from PIL import Image, ImageDraw

DEST = Path(__file__).resolve().parents[1] / 'miniprogram' / 'assets'
DEST.mkdir(parents=True, exist_ok=True)
SCALE = 3

def render(name, color):
    image = Image.new('RGBA', (81 * SCALE, 81 * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    def line(points, width=4):
        draw.line([(int(x * SCALE), int(y * SCALE)) for x, y in points], fill=color, width=width*SCALE, joint='curve')
    def oval(box):
        draw.ellipse(tuple(int(n*SCALE) for n in box), outline=color, width=4*SCALE)
    if name == 'garden':
        line([(40, 68), (40, 25)])
        draw.arc((17*SCALE, 12*SCALE, 43*SCALE, 48*SCALE), 70, 300, fill=color, width=4*SCALE)
        draw.arc((38*SCALE, 16*SCALE, 64*SCALE, 52*SCALE), -120, 110, fill=color, width=4*SCALE)
        line([(40, 48), (24, 30)])
        line([(40, 51), (56, 33)])
        line([(25, 68), (55, 68)])
    elif name == 'books':
        line([(40, 23), (26, 18), (12, 18), (12, 59), (26, 59), (40, 65), (55, 59), (69, 59), (69, 18), (55, 18), (40, 23), (40, 65)])
        line([(20, 30), (30, 30)], 3)
        line([(51, 30), (61, 30)], 3)
        line([(20, 40), (30, 40)], 3)
        line([(51, 40), (61, 40)], 3)
    elif name == 'room':
        line([(10, 37), (40, 13), (70, 37)])
        line([(19, 32), (19, 65), (61, 65), (61, 32)])
        line([(33, 65), (33, 44), (48, 44), (48, 65)])
    elif name == 'mine':
        oval((28, 13, 53, 38))
        draw.arc((16*SCALE, 44*SCALE, 65*SCALE, 86*SCALE), 180, 360, fill=color, width=4*SCALE)
        line([(16, 66), (65, 66)])
    return image.resize((81, 81), Image.Resampling.LANCZOS)

for name in ('garden', 'books', 'room', 'mine'):
    for suffix, color in (('', '#727b70'), ('-active', '#315e46')):
        render(name, color).save(DEST / f'{name}{suffix}.png')
print('Generated 8 tab icons')
