"""Builds resources/icon-dev.png: the app icon with a white "DEV" mark over its lower part (dev builds' taskbar icon)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
icon = Image.open(root / 'resources' / 'icon.png').convert('RGBA')
size = icon.width
draw = ImageDraw.Draw(icon)
font = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', int(size * 0.27))
text = 'DEV'
box = draw.textbbox((0, 0), text, font=font)
x = (size - (box[2] - box[0])) / 2 - box[0]
y = size * 0.86 - box[3]
# A dark outline keeps the white letters readable over the silver bee at taskbar size.
draw.text((x, y), text, font=font, fill='white', stroke_width=int(size * 0.022), stroke_fill=(10, 10, 12, 255))
icon.save(root / 'resources' / 'icon-dev.png')
print('wrote resources/icon-dev.png')
