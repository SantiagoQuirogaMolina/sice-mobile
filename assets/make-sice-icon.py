# -*- coding: utf-8 -*-
"""Genera los íconos de la app móvil SICE: portapapeles + check en neón cian
sobre navy, con hex EXACTOS de marca (#00D4FF / #0D1B2A). Produce:
  - icon.png           1024x1024  (full-bleed, fondo navy)
  - adaptive-icon.png  1024x1024  (foreground transparente, dentro de zona segura)
  - icon-mono.png      1024x1024  (silueta blanca transparente, Android 13+)
Render a 2x con supersampling y reducción LANCZOS para bordes nítidos.
Uso: python assets/make-sice-icon.py"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(__file__)
SS = 2
SIZE = 1024 * SS

CYAN = (0, 212, 255, 255)        # #00D4FF
CYAN_HI = (170, 242, 255, 255)   # realce interior del "tubo" neón
NAVY = (13, 27, 42, 255)         # #0D1B2A
WHITE = (255, 255, 255, 255)


def _rcaps(draw, pts, width, fill):
    """Polilínea con remates redondeados (para el check)."""
    draw.line(pts, fill=fill, width=int(width), joint="curve")
    r = int(width / 2)
    for (x, y) in pts:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def draw_shapes(canvas, wm, color, scale_w=1.0):
    """Dibuja portapapeles + clip + check centrados, ancho de motivo = wm px."""
    d = ImageDraw.Draw(canvas)
    hm = wm * 1.15
    x0 = (canvas.width - wm) / 2
    y0 = (canvas.height - hm) / 2
    X = lambda u: x0 + u * wm
    Y = lambda v: y0 + v * hm

    board_w = max(2, int(0.034 * wm * scale_w))
    clip_w = max(2, int(0.030 * wm * scale_w))
    slot_w = max(2, int(0.022 * wm * scale_w))
    check_w = max(2, int(0.060 * wm * scale_w))

    # Tablero (rounded rect, solo contorno)
    d.rounded_rectangle([X(0.10), Y(0.13), X(0.90), Y(1.00)],
                        radius=int(0.10 * wm), outline=color, width=board_w)
    # Clip superior (rounded rect)
    d.rounded_rectangle([X(0.31), Y(0.00), X(0.69), Y(0.205)],
                        radius=int(0.075 * wm), outline=color, width=clip_w)
    # Ranura del clip (pastilla)
    d.rounded_rectangle([X(0.42), Y(0.072), X(0.58), Y(0.118)],
                        radius=int(0.05 * wm), outline=color, width=slot_w)
    # Check
    pts = [(X(0.275), Y(0.560)), (X(0.430), Y(0.745)), (X(0.720), Y(0.400))]
    _rcaps(d, pts, check_w, color)


def render_motif(wm, color=CYAN, glow=True):
    """Capa transparente con el motivo + glow neón."""
    core = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_shapes(core, wm, color)
    if not glow:
        return core
    # realce interior más claro (efecto tubo)
    hi = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_shapes(hi, wm, CYAN_HI, scale_w=0.42)

    glow_big = core.filter(ImageFilter.GaussianBlur(radius=wm * 0.050))
    glow_sm = core.filter(ImageFilter.GaussianBlur(radius=wm * 0.016))

    motif = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    motif.alpha_composite(glow_big)
    motif.alpha_composite(glow_big)   # intensifica el halo
    motif.alpha_composite(glow_sm)
    motif.alpha_composite(core)
    motif.alpha_composite(hi)
    return motif


def finish(img):
    return img.resize((1024, 1024), Image.LANCZOS)


# 1) icon.png — full-bleed sobre navy (motivo ~66%)
icon = Image.new("RGBA", (SIZE, SIZE), NAVY)
icon.alpha_composite(render_motif(int(0.66 * SIZE)))
finish(icon).save(os.path.join(HERE, "icon.png"))

# 2) adaptive-icon.png — foreground transparente, motivo ~55% (zona segura)
adaptive = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
adaptive.alpha_composite(render_motif(int(0.55 * SIZE)))
finish(adaptive).save(os.path.join(HERE, "adaptive-icon.png"))

# 3) icon-mono.png — silueta blanca transparente (Android 13+ themed)
mono = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
mono.alpha_composite(render_motif(int(0.55 * SIZE), color=WHITE, glow=False))
finish(mono).save(os.path.join(HERE, "icon-mono.png"))

print("OK: icon.png, adaptive-icon.png, icon-mono.png (1024x1024)")
