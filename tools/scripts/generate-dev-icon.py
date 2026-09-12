"""Regenerate the Dev source icon before running `pnpm exec tauri icon`."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
ICONS = ROOT / "src" / "apps" / "desktop" / "src-tauri" / "icons"
SOURCE = ICONS / "icon.png"
OUTPUT = ICONS / "dev" / "icon.png"


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    logo = source.resize((386, 386), Image.Resampling.LANCZOS)
    canvas.alpha_composite(logo, (63, 0))

    draw = ImageDraw.Draw(canvas)
    draw.rectangle((83, 388, 429, 500), fill="white")
    font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 82)
    bounds = draw.textbbox((0, 0), "DEV", font=font)
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    draw.text(((512 - width) / 2 - bounds[0], 388 + (112 - height) / 2 - bounds[1]), "DEV", font=font, fill="black")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT)


if __name__ == "__main__":
    main()
