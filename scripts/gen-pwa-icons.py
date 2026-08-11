"""One-off generator for the submission-link PWA icons.

Kept in the repo so the icons can be regenerated rather than being opaque
binaries. Draws a rounded-square badge in the app's primary blue with a simple
document + checkmark glyph — the submission link is "file an invoice".

Run: python3 scripts/gen-pwa-icons.py
"""

from PIL import Image, ImageDraw

BLUE = (29, 95, 176, 255)  # --primary (light), #1d5fb0
WHITE = (255, 255, 255, 255)
OUT = "apps/web/public"


def draw_icon(size: int, maskable: bool) -> Image.Image:
    # Supersample 4x and downscale; PIL has no antialiased vector drawing.
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable:
        # A maskable icon is cropped to whatever shape the launcher wants, so
        # the background must bleed to the edges and the glyph must sit inside
        # the safe zone (the middle 80%).
        d.rectangle([0, 0, s, s], fill=BLUE)
        inset = s * 0.28
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BLUE)
        inset = s * 0.24

    # Document sheet
    left, top = inset, inset
    right, bottom = s - inset, s - inset * 0.88
    fold = (right - left) * 0.30
    d.polygon(
        [
            (left, top),
            (right - fold, top),
            (right, top + fold),
            (right, bottom),
            (left, bottom),
        ],
        fill=WHITE,
    )

    # Two text rules across the top half
    line_x0 = left + (right - left) * 0.15
    line_x1 = right - (right - left) * 0.15
    lw = max(2, int(s * 0.020))
    for frac in (0.26, 0.42):
        y = top + (bottom - top) * frac
        d.line([(line_x0, y), (line_x1, y)], fill=BLUE, width=lw)

    # Checkmark filling the lower half, clear of the rules
    cw = max(3, int(s * 0.060))
    d.line(
        [
            (left + (right - left) * 0.22, top + (bottom - top) * 0.68),
            (left + (right - left) * 0.42, top + (bottom - top) * 0.83),
            (left + (right - left) * 0.80, top + (bottom - top) * 0.56),
        ],
        fill=BLUE,
        width=cw,
        joint="curve",
    )

    return img.resize((size, size), Image.LANCZOS)


for size, name, maskable in (
    (192, "icon-192.png", False),
    (512, "icon-512.png", False),
    (512, "icon-maskable-512.png", True),
    (180, "apple-touch-icon.png", False),
):
    draw_icon(size, maskable).save(f"{OUT}/{name}")
    print(f"wrote {OUT}/{name}")
