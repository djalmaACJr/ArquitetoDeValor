"""
Recorta `FrontEnd/public/mascotes/aponstando.todos.png` em 8 PNGs
individuais, um por mascote × direção:

    sabio-apontando-esquerda.png    sabio-apontando-direita.png
    arquiteta-apontando-esquerda.png arquiteta-apontando-direita.png
    raposa-apontando-esquerda.png    raposa-apontando-direita.png
    gato-apontando-esquerda.png      gato-apontando-direita.png

Estratégia:
  1. Divide a imagem em grade 5 colunas × 2 linhas (uniforme)
  2. Para cada célula, detecta a bounding box da sprite (não-fundo)
  3. Aplica alpha proporcional à distância do fundo marrom
  4. Salva o PNG cortado no bbox da sprite + margem

Idempotente: re-rodar não corrompe nada.
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
from PIL import Image

SRC = Path("FrontEnd/public/mascotes/aponstando.todos.png")
OUT_DIR = Path("FrontEnd/public/mascotes")

# Ordem das células (row, col) → (mascote, direção)
LAYOUT = {
    (0, 0): ("sabio",     "esquerda"),
    (0, 1): ("sabio",     "direita"),
    (0, 2): ("arquiteta", "esquerda"),
    (0, 3): ("arquiteta", "direita"),
    (0, 4): ("raposa",    "esquerda"),
    (1, 0): ("raposa",    "direita"),
    (1, 1): ("gato",      "esquerda"),
    (1, 2): ("gato",      "direita"),
}

LINHAS = 2
COLUNAS = 5
MARGEM_PX = 6   # margem extra ao redor do bbox detectado


def detectar_bg(arr: np.ndarray) -> np.ndarray:
    """Mediana de 4 cantos pra estimar a cor de fundo."""
    h, w = arr.shape[:2]
    s = 10
    samples = np.concatenate([
        arr[:s, :s, :3].reshape(-1, 3),
        arr[:s, -s:, :3].reshape(-1, 3),
        arr[-s:, :s, :3].reshape(-1, 3),
        arr[-s:, -s:, :3].reshape(-1, 3),
    ])
    return np.median(samples, axis=0)


def aplicar_alpha(arr_rgba: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Alpha proporcional à distância da cor de fundo (bordas suaves).
    Curva mais agressiva pra manter cores próximas do fundo (ex.: casaco
    marrom do Sábio) visíveis sem virar transparentes."""
    rgb = arr_rgba[:, :, :3].astype(np.int16)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    # alpha=0 até dist=10; alpha=255 a partir de dist=35
    a = np.clip((dist - 10) * (255 / 25), 0, 255).astype(np.uint8)
    out = arr_rgba.copy()
    out[:, :, 3] = a
    return out


def bbox_sprite_principal(ink: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    """Acha o bbox da SPRITE principal (figura grande), ignorando o label
    de texto que aparece embaixo. Estratégia: pega o maior conjunto
    contíguo de linhas com densidade alta de ink."""
    h, w = ink.shape
    if ink.sum() == 0:
        return None
    rows = ink.sum(axis=1)
    # Densidade "alta" = pelo menos 15% da largura da célula
    alta = rows > w * 0.15
    if not alta.any():
        return None
    # Acha o maior conjunto contíguo de linhas com densidade alta
    melhor: Optional[Tuple[int, int]] = None  # (start, end)
    i = 0
    while i < h:
        if alta[i]:
            j = i
            while j < h and alta[j]:
                j += 1
            if melhor is None or (j - i) > (melhor[1] - melhor[0]):
                melhor = (i, j)
            i = j
        else:
            i += 1
    if melhor is None:
        return None
    y_top, y_bot = melhor
    # Bbox horizontal dentro dessa faixa vertical
    cols = ink[y_top:y_bot, :].sum(axis=0)
    nz_x = np.where(cols > 0)[0]
    if len(nz_x) == 0:
        return None
    return int(y_top), int(nz_x.min()), int(y_bot - 1), int(nz_x.max())


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"erro: {SRC} não encontrado")

    src = Image.open(SRC).convert("RGBA")
    arr = np.array(src)
    bg = detectar_bg(arr)
    print(f"cor de fundo detectada: RGB{tuple(int(v) for v in bg)}")

    arr_alpha = aplicar_alpha(arr, bg)
    ink_global = arr_alpha[:, :, 3] > 64

    h, w = arr.shape[:2]
    cell_h = h // LINHAS
    cell_w = w // COLUNAS

    for (row, col), (mascote, direcao) in LAYOUT.items():
        y0, y1 = row * cell_h, (row + 1) * cell_h
        x0, x1 = col * cell_w, (col + 1) * cell_w
        cell_ink = ink_global[y0:y1, x0:x1]

        bb = bbox_sprite_principal(cell_ink)
        if bb is None:
            print(f"AVISO: célula ({row},{col}) vazia — pulando {mascote}/{direcao}")
            continue
        sy0, sx0, sy1, sx1 = bb

        # Margem extra e clamp
        sy0 = max(0, sy0 - MARGEM_PX)
        sx0 = max(0, sx0 - MARGEM_PX)
        sy1 = min(cell_h - 1, sy1 + MARGEM_PX)
        sx1 = min(cell_w - 1, sx1 + MARGEM_PX)

        crop = arr_alpha[y0 + sy0:y0 + sy1 + 1, x0 + sx0:x0 + sx1 + 1]
        out_path = OUT_DIR / f"{mascote}-apontando-{direcao}.png"
        Image.fromarray(crop, "RGBA").save(out_path, optimize=True)
        print(f"OK {out_path.name}  {crop.shape[1]}x{crop.shape[0]}  "
              f"({out_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
