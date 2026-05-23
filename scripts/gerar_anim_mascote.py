"""
Gera FrontEnd/public/mascotes/{mascote}-andando.webm a partir do
sprite sheet `{mascote}-frames.png`.

Espera-se que o sprite sheet tenha o seguinte layout:
  [ prateleira + personagem-no-móvel ] [ walk1 ] [ walk2 ] [ walk3 ]

Uso:
    python scripts/gerar_anim_mascote.py sabio
    python scripts/gerar_anim_mascote.py arquiteta

Pipeline:
  1. Carrega o sprite sheet
  2. Detecta a cor de fundo automaticamente (mediana dos 4 cantos)
  3. Aplica alpha proporcional à distância da cor de fundo (bordas suaves)
  4. Detecta as 4+1 regiões via densidade de tinta por coluna
  5. Acha a divisão prateleira ↔ personagem-no-móvel dentro do primeiro grupo
  6. Compõe 90 frames (3s @ 30fps): caminhada R→L + pegar livro
  7. Encoda WebM VP9 com alpha (yuva420p) usando ffmpeg embutido
"""
from __future__ import annotations

from pathlib import Path
import argparse
import subprocess
import tempfile
import shutil
import sys

import numpy as np
from PIL import Image
import imageio_ffmpeg

# ── Parâmetros da cena ─────────────────────────────────────────────────
W, H = 480, 320
FPS = 30
DUR = 3.0
TOTAL = int(FPS * DUR)

WALK_FRAMES = int(TOTAL * 0.78)
FADE_FRAMES = 4
HOLD_FRAMES = TOTAL - WALK_FRAMES - FADE_FRAMES

# Overrides por mascote — usar quando a auto-detecção do split prateleira ↔
# personagem-no-móvel falha (ex.: braço estendido invadindo as colunas da
# estante). `shelf_right_x` é a coluna no sprite sheet onde a parte
# "estante limpa" termina (próximo do início do braço/mão do personagem).
OVERRIDES: dict[str, dict[str, int]] = {
    # arquiteta tem o braço esticado horizontalmente sobre os livros — a
    # estante "limpa" termina antes do braço.
    "arquiteta": {"shelf_right_x": 420},
}


def detectar_bg(arr: np.ndarray) -> np.ndarray:
    """Cor de fundo = mediana dos 4 cantos do sprite sheet."""
    h, w = arr.shape[:2]
    s = 10  # amostra 10x10 em cada canto
    samples = np.concatenate([
        arr[:s, :s, :3].reshape(-1, 3),
        arr[:s, -s:, :3].reshape(-1, 3),
        arr[-s:, :s, :3].reshape(-1, 3),
        arr[-s:, -s:, :3].reshape(-1, 3),
    ])
    return np.median(samples, axis=0)


def aplicar_alpha(arr: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Alpha = distância da cor de fundo, normalizada com easing.

    Limiares conservadores (alpha=0 até dist=25) pra evitar haze do
    fundo em sprites com cor escura próxima ao bg (ex.: gato).
    """
    rgb = arr[:, :, :3].astype(np.int16)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    a = np.clip((dist - 25) * (255 / 35), 0, 255).astype(np.uint8)
    out = arr.copy()
    if out.shape[2] == 3:
        out = np.dstack([out, a])
    else:
        out[:, :, 3] = a
    return out


def _detectar_grupos_de_col(
    col: np.ndarray, threshold: float, min_largura: int
) -> list[tuple[int, int]]:
    grupos: list[tuple[int, int]] = []
    in_g = False
    start = 0
    for i, v in enumerate(col):
        if v > threshold and not in_g:
            start = i; in_g = True
        elif v <= threshold and in_g:
            if i - start >= min_largura:
                grupos.append((start, i))
            in_g = False
    if in_g and len(col) - start >= min_largura:
        grupos.append((start, len(col)))
    return grupos


def detectar_grupos_e_alpha(
    arr_rgba: np.ndarray, bg: np.ndarray, min_largura: int = 60
) -> tuple[list[tuple[int, int]], np.ndarray]:
    """Encontra 4 ou 5 grupos contíguos de colunas com tinta significativa.

    Itera sobre vários thresholds de distância da cor de fundo até achar
    um que produza 4 ou 5 grupos. Retorna também a máscara de tinta usada.
    """
    rgb = arr_rgba[:, :, :3].astype(np.int16)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))

    # Coleta resultados pra cada threshold; preferimos 5 grupos (estante
    # e personagem-no-móvel separados) sobre 4 (fundidos).
    candidato_5: tuple[list[tuple[int, int]], np.ndarray] | None = None
    candidato_4: tuple[list[tuple[int, int]], np.ndarray] | None = None
    ultimo: tuple[list[tuple[int, int]], np.ndarray] | None = None
    for t in (30, 45, 60, 80, 100, 120):
        ink = (dist > t).astype(np.uint8)
        col = ink.sum(axis=0)
        if col.max() == 0:
            continue
        grupos = _detectar_grupos_de_col(col, col.max() * 0.05, min_largura)
        ultimo = (grupos, ink)
        if len(grupos) == 5 and candidato_5 is None:
            candidato_5 = (grupos, ink)
        elif len(grupos) == 4 and candidato_4 is None:
            candidato_4 = (grupos, ink)
    if candidato_5 is not None:
        return candidato_5
    if candidato_4 is not None:
        return candidato_4
    if ultimo is not None:
        print(f"  aviso: nenhum threshold deu 4/5 grupos. último: "
              f"{len(ultimo[0])} grupos = {ultimo[0]}")
        return ultimo
    return [], (dist > 30).astype(np.uint8)


def detectar_split_prateleira(ink: np.ndarray, x0: int, x1: int) -> int:
    """Dentro do primeiro grupo (estante + personagem), acha a coluna do
    'vale' de densidade que separa estante (esquerda) e personagem
    (direita)."""
    col = ink[:, x0:x1].sum(axis=0)
    # procura o mínimo local na metade central do grupo
    janela_ini = len(col) // 4
    janela_fim = len(col) * 3 // 4
    rel = janela_ini + int(np.argmin(col[janela_ini:janela_fim]))
    return x0 + rel


def detectar_y_range(ink: np.ndarray) -> tuple[int, int]:
    rows = ink.sum(axis=1)
    nz = np.where(rows > 0)[0]
    return int(nz.min()), int(nz.max())


def escalar_para_altura(im: Image.Image, alvo_h: int) -> Image.Image:
    ratio = alvo_h / im.height
    return im.resize((max(int(im.width * ratio), 1), alvo_h), Image.LANCZOS)


def gerar(mascote: str) -> None:
    src_path = Path(f"FrontEnd/public/mascotes/{mascote}-frames.png")
    out_path = Path(f"FrontEnd/public/mascotes/{mascote}-andando.webm")
    if not src_path.exists():
        sys.exit(f"erro: {src_path} não encontrado")

    # ── 1. Carrega e detecta cor de fundo ──────────────────────────────
    arr = np.array(Image.open(src_path).convert("RGBA"))
    bg = detectar_bg(arr)
    print(f"[{mascote}] cor de fundo detectada: RGB{tuple(int(v) for v in bg)}")

    # ── 2. Detecta grupos horizontais (com threshold adaptativo) ──────
    grupos, ink = detectar_grupos_e_alpha(arr, bg)
    if len(grupos) not in (4, 5):
        sys.exit(f"erro: esperava 4 ou 5 grupos, achei {len(grupos)}: {grupos}")
    arr = aplicar_alpha(arr, bg)
    sheet = Image.fromarray(arr, "RGBA")

    # ── 3. Identifica estante / segurando / walks ─────────────────────
    if len(grupos) == 5:
        # estante e personagem-no-móvel já vêm separados
        g_estante, g_seg, *walks_g = grupos
        split_x = g_estante[1]  # corte direto na borda direita da estante
        seg_range = g_seg
        print(f"[{mascote}] grupos (5): estante={g_estante} seg={g_seg} "
              f"walks={walks_g}")
    else:  # len == 4
        # estante e personagem-no-móvel fundidos no primeiro grupo
        g_estante, *walks_g = grupos
        override = OVERRIDES.get(mascote, {}).get("shelf_right_x")
        if override is not None:
            split_x = override
            print(f"[{mascote}] grupos (4): estante={g_estante} "
                  f"walks={walks_g}  split (override)={split_x}")
        else:
            split_x = detectar_split_prateleira(ink, *g_estante)
            print(f"[{mascote}] grupos (4): estante={g_estante} "
                  f"walks={walks_g}  split (auto)={split_x}")
        seg_range = (split_x, g_estante[1])
        g_estante = (g_estante[0], split_x)
    g_w1, g_w2, g_w3 = walks_g

    # ── 5. Acha y-range global (com margem) ───────────────────────────
    y0, y1 = detectar_y_range(ink)
    margem_y = 16
    y0 = max(y0 - margem_y, 0)
    y1 = min(y1 + margem_y, arr.shape[0])
    print(f"[{mascote}] y-range: {y0}..{y1}")

    def crop(x0: int, x1: int) -> Image.Image:
        return sheet.crop((x0, y0, x1, y1))

    PRATELEIRA = crop(g_estante[0], g_estante[1])
    SEGURANDO  = crop(seg_range[0], seg_range[1])
    walks_orig = [crop(*g) for g in (g_w1, g_w2, g_w3)]

    # ── 6. Escala todas as sprites pra mesma altura ───────────────────
    altura_personagem = int(H * 0.82)
    PRATELEIRA = escalar_para_altura(PRATELEIRA, altura_personagem)
    SEGURANDO  = escalar_para_altura(SEGURANDO,  altura_personagem)
    walks = [escalar_para_altura(w, altura_personagem) for w in walks_orig]

    # ── 7. Posicionamento no canvas ───────────────────────────────────
    base_y = H - altura_personagem - 10
    prateleira_x = 8
    segurando_x  = prateleira_x + PRATELEIRA.width - 12  # encosta na estante
    walk_w = walks[0].width
    walk_x_end   = segurando_x + 10
    walk_x_start = W - walk_w + 60

    # ── 8. Renderiza frames ───────────────────────────────────────────
    tmp = Path(tempfile.mkdtemp(prefix=f"anim_{mascote}_"))
    try:
        for f in range(TOTAL):
            canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            canvas.alpha_composite(PRATELEIRA, (prateleira_x, base_y))

            if f < WALK_FRAMES:
                t = f / max(WALK_FRAMES - 1, 1)
                e = 1 - (1 - t) ** 1.4  # easing: desacelera no fim
                x = int(walk_x_start + (walk_x_end - walk_x_start) * e)
                sprite = walks[(f // 5) % 3]
                dy = -2 if (f // 3) % 2 == 0 else 1
                canvas.alpha_composite(sprite, (x, base_y + dy))
            elif f < WALK_FRAMES + FADE_FRAMES:
                t = (f - WALK_FRAMES) / max(FADE_FRAMES, 1)
                w_sprite = walks[(WALK_FRAMES // 5) % 3]
                w_arr = np.array(w_sprite)
                w_arr[:, :, 3] = (w_arr[:, :, 3] * (1 - t)).astype(np.uint8)
                canvas.alpha_composite(Image.fromarray(w_arr, "RGBA"),
                                       (walk_x_end, base_y))
                h_arr = np.array(SEGURANDO)
                h_arr[:, :, 3] = (h_arr[:, :, 3] * t).astype(np.uint8)
                canvas.alpha_composite(Image.fromarray(h_arr, "RGBA"),
                                       (segurando_x, base_y))
            else:
                canvas.alpha_composite(SEGURANDO, (segurando_x, base_y))

            canvas.save(tmp / f"frame_{f:03d}.png")

        # ── 9. Encoda WebM VP9 com alpha ──────────────────────────────
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        cmd = [
            ffmpeg, "-y",
            "-framerate", str(FPS),
            "-i", str(tmp / "frame_%03d.png"),
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuva420p",
            "-b:v", "0", "-crf", "32",
            "-auto-alt-ref", "0",
            "-an",
            str(out_path),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"OK -> {out_path}  ({out_path.stat().st_size // 1024} KB)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Gera WebM de loading do mascote")
    p.add_argument("mascote", help="Nome interno: sabio | arquiteta | gato | raposa")
    args = p.parse_args()
    gerar(args.mascote)
