# -*- coding: utf-8 -*-
"""
Генерация PNG-иконок и splash-экранов для PWA из дизайна public/favicon.svg.

Разовая утилита: запускать только если поменялся логотип.
    pip install pillow
    python scripts/gen-pwa-icons.py     # пишет прямо в public/

Почему не берём сам SVG: iOS не поддерживает SVG в apple-touch-icon и в
apple-touch-startup-image — при ссылке на .svg система ставит вместо значка
скриншот страницы. Нужен растр. Рисуем ту же картинку через PIL: фон-градиент
в финальном размере (градиенту сглаживание не нужно), фигуры — на прозрачном
слое с 4-кратным оверсэмплингом и уменьшением LANCZOS.

Список splash-разрешений должен совпадать со ссылками apple-touch-startup-image
в index.html: если добавить файл сюда и забыть про index.html, iOS его не
увидит и покажет белый экран.
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, 'splash'), exist_ok=True)

SS = 4                      # коэффициент оверсэмплинга
VB = 64.0                   # viewBox исходного SVG
BG_A, BG_B = (0x06, 0xb6, 0xd4), (0x3b, 0x82, 0xf6)   # cyan-500 → blue-500
LOCK_A, LOCK_B = (0x0c, 0x4a, 0x6e), (0x03, 0x69, 0xa1)
SPLASH_BG = (0x06, 0x09, 0x13)                        # верх градиента .site-bg


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def diagonal_gradient(size, c1, c2):
    """Аналог linearGradient x1=0 y1=0 x2=1 y2=1."""
    img = Image.new('RGB', (size, size))
    denom = max(1, 2 * (size - 1))
    row_cache = {}
    px = []
    for y in range(size):
        row = row_cache.get(y)
        if row is None:
            row = [lerp(c1, c2, (x + y) / denom) for x in range(size)]
        px.extend(row)
    img.putdata(px)
    return img


def vertical_gradient_circle(draw_size, c1, c2):
    """Круглая заливка вертикальным градиентом — для бейджа-замка."""
    grad = Image.new('RGB', (draw_size, draw_size))
    grad.putdata([lerp(c1, c2, y / max(1, draw_size - 1))
                  for y in range(draw_size) for _ in range(draw_size)])
    mask = Image.new('L', (draw_size, draw_size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, draw_size - 1, draw_size - 1], fill=255)
    grad.putalpha(mask)
    return grad


def draw_art(size, inset=0.0):
    """
    Рисует глобус и замок на прозрачном слое размера size.
    inset — доля поля, оставляемая пустой по краям (для maskable-иконки).
    """
    canvas = size * SS
    layer = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    art = canvas * (1 - 2 * inset)
    off = canvas * inset
    k = art / VB                       # единица viewBox → пиксели слоя

    def X(v):
        return off + v * k

    def box(cx, cy, rx, ry):
        return [X(cx - rx), X(cy - ry), X(cx + rx), X(cy + ry)]

    W = (255, 255, 255, 242)           # opacity 0.95 у группы глобуса
    w3 = max(1, round(3 * k))

    # Глобус: круг + меридиан + экватор
    d.ellipse(box(29, 29, 18, 18), outline=W, width=w3)
    d.ellipse(box(29, 29, 7.5, 18), outline=W, width=w3)
    d.line([X(11), X(29), X(47), X(29)], fill=W, width=w3)

    # Бейдж-замок: круг с градиентом и белой обводкой
    lock_d = round(24 * k)
    badge = vertical_gradient_circle(lock_d, LOCK_A, LOCK_B)
    layer.alpha_composite(badge, (round(X(37)), round(X(37))))
    d.ellipse(box(49, 49, 12, 12), outline=(255, 255, 255, 255), width=max(1, round(1.5 * k)))

    # Корпус замка
    d.rounded_rectangle([X(44.5), X(49), X(53.5), X(56.5)],
                        radius=1.5 * k, fill=(255, 255, 255, 255))
    # Дужка: полуокружность сверху + два прямых участка вниз до корпуса
    w16 = max(1, round(1.6 * k))
    d.arc(box(49, 47, 3, 3), 180, 360, fill=(255, 255, 255, 255), width=w16)
    d.line([X(46), X(47), X(46), X(49)], fill=(255, 255, 255, 255), width=w16)
    d.line([X(52), X(47), X(52), X(49)], fill=(255, 255, 255, 255), width=w16)
    # Скважина
    d.ellipse(box(49, 52.3, 0.9, 0.9), fill=LOCK_A + (255,))

    return layer.resize((size, size), Image.LANCZOS)


def icon(size, inset=0.0):
    """Иконка во всё поле: свои скруглённые углы не рисуем — iOS и Android
    накладывают собственную маску, и запечённое скругление дало бы кайму."""
    img = diagonal_gradient(size, BG_A, BG_B).convert('RGBA')
    img.alpha_composite(draw_art(size, inset))
    return img.convert('RGB')


def rounded(img, radius_ratio=0.225):
    """Скруглить углы (для splash — там маску никто не накладывает)."""
    img = img.convert('RGBA')
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, img.size[0] - 1, img.size[1] - 1],
        radius=round(img.size[0] * radius_ratio), fill=255)
    img.putalpha(mask)
    return img


# ── Иконки ──────────────────────────────────────────────────────────────────
base512 = icon(512)
files = {
    'apple-touch-icon.png': base512.resize((180, 180), Image.LANCZOS),
    'icon-192.png': base512.resize((192, 192), Image.LANCZOS),
    'icon-512.png': base512,
    # maskable: артворк ужат в «безопасную зону» — Android обрежет края
    'icon-512-maskable.png': icon(512, inset=0.14),
}
for name, im in files.items():
    im.save(os.path.join(OUT, name), 'PNG', optimize=True)
    print(name, im.size, os.path.getsize(os.path.join(OUT, name)), 'Б')

# ── Splash-экраны ───────────────────────────────────────────────────────────
# Без них iOS показывает при запуске белый прямоугольник — главный признак
# «это сайт, а не приложение». Размеры в пикселях = точки × масштаб экрана.
SPLASHES = [
    (1320, 2868), (1206, 2622),   # iPhone 16 Pro Max / 16 Pro
    (1290, 2796), (1179, 2556),   # 15 Pro Max, 15 / 15 Pro, 14 Pro
    (1284, 2778), (1170, 2532),   # 12-13 Pro Max / 12-14
    (1242, 2688), (1125, 2436),   # XS Max, 11 Pro Max / X, XS, 11 Pro
    (828, 1792),                  # XR, 11
    (1242, 2208), (750, 1334),    # 8 Plus / SE, 8
]
logo_cache = {}
for w, h in SPLASHES:
    img = Image.new('RGB', (w, h), SPLASH_BG)
    side = round(min(w, h) * 0.28)
    logo = logo_cache.get(side)
    if logo is None:
        logo = rounded(base512.resize((side, side), Image.LANCZOS))
        logo_cache[side] = logo
    img.paste(logo, ((w - side) // 2, (h - side) // 2), logo)
    p = os.path.join(OUT, 'splash', f'{w}x{h}.png')
    img.save(p, 'PNG', optimize=True)
    print('splash', f'{w}x{h}', os.path.getsize(p), 'Б')
