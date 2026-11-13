"""Convert and shrink project images to WebP.

    python tools/optimize_images.py assets/projects/<id>

Files whose name starts with "logo" keep transparency and are capped at 900 px wide,
everything else (screenshots) is capped at 1400 px. SVG files are left alone.
Originals are replaced by a .webp file with the same base name. Needs Pillow (pip install pillow).
"""
import os
import sys

from PIL import Image


def optimize(folder):
    for name in sorted(os.listdir(folder)):
        src = os.path.join(folder, name)
        base, ext = os.path.splitext(name)
        if not os.path.isfile(src) or ext.lower() in (".svg",):
            continue
        is_logo = base.lower().startswith("logo")
        with Image.open(src) as im:
            try:
                im.seek(0)
            except EOFError:
                pass
            im = im.convert("RGBA" if is_logo else "RGB")
            max_w = 900 if is_logo else 1400
            if im.width > max_w:
                im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
            out = os.path.join(folder, base + ".webp")
            im.save(out, "WEBP", quality=82, method=6)
        if os.path.abspath(out) != os.path.abspath(src):
            os.remove(src)
        print(f"{out}  {im.size[0]}x{im.size[1]}  {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        print(__doc__)
        sys.exit(1)
    optimize(sys.argv[1])
