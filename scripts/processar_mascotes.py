#!/usr/bin/env python3
"""
Processa imagens dos mascotes:
  1. Detecta tons dominantes do fundo (checkerboard + bordas escuras)
     via histograma de tiras nas 4 bordas.
  2. Cria uma MÁSCARA de pixels que casam com qualquer um desses tons
     (com tolerância). Em uma imagem clean isso já é o background, mas
     pode incluir manchas isoladas dentro do personagem.
  3. Usa scipy.ndimage.label para encontrar componentes conectadas da
     máscara. Identifica as componentes que TOCAM a borda da imagem —
     essas são o fundo de verdade. Componentes isoladas (manchas no
     personagem com cor similar) são RESTAURADAS.
  4. Recorta para a bounding box do que sobra opaco + margem.

Uso: py scripts/processar_mascotes.py
"""

from pathlib import Path
from PIL import Image
import numpy as np
from scipy import ndimage

# Canal-a-canal: quão próximo o pixel precisa estar de um tom detectado
# para virar candidato. 24 captura checkers complexos do Sábio; cores
# acidentalmente similares no personagem são restauradas via CC.
TOL_TOM = 24

# Quantos tons dominantes pegar do histograma das bordas. 16 cobre
# checkers multitom + bordas pretas/brancas.
N_TONS = 16

# Margem em pixels ao redor da bounding box do personagem.
MARGEM_BBOX = 10

ARQUIVOS = [
    ('sabio-curioso.jpg',         'sabio-curioso.png'),
    ('sabio-feliz.jpg',           'sabio-feliz.png'),
    ('sabio-espantado.jpg',       'sabio-espantado.png'),
    ('sabio-adnando.jpg',         'sabio-andando.png'),
    ('sabio-setnado.jpg',         'sabio-sentado.png'),
    ('engenheira-andando.jpg',    'engenheira-andando.png'),
    ('engenheira-pensandp.jpg',   'engenheira-pensando.png'),
    ('engenheira-espantado.jpg',  'engenheira-espantado.png'),
    ('engenheira-feliz.jpg',      'engenheira-feliz.png'),
]

RAIZ = Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / 'Mascotes'
DESTINO = RAIZ / 'FrontEnd' / 'public' / 'mascotes'


def detectar_tons(arr: np.ndarray) -> list[tuple[int, int, int]]:
    """Amostra tiras de 10px nas 4 bordas, devolve top N_TONS após
    quantização em buckets de 4."""
    h, w, _ = arr.shape
    esp = 10
    tiras = np.concatenate([
        arr[:esp].reshape(-1, 3),                # topo
        arr[-esp:].reshape(-1, 3),               # base
        arr[:, :esp].reshape(-1, 3),             # esquerda
        arr[:, -esp:].reshape(-1, 3),            # direita
    ], axis=0)
    quant = ((tiras >> 2) << 2).astype(np.int32)  # quantiza para múltiplos de 4
    keys = quant[:, 0] * 65536 + quant[:, 1] * 256 + quant[:, 2]
    unique, counts = np.unique(keys, return_counts=True)
    ordem = np.argsort(-counts)[:N_TONS]
    tons = []
    for idx in ordem:
        k = unique[idx]
        r = (k >> 16) & 0xFF
        g = (k >> 8)  & 0xFF
        b = k         & 0xFF
        tons.append((int(r), int(g), int(b)))
    return tons


def construir_mascara(arr: np.ndarray, tons: list[tuple[int, int, int]], tol: int) -> np.ndarray:
    """Retorna máscara booleana: True onde o pixel está dentro da
    tolerância de algum tom detectado."""
    h, w, _ = arr.shape
    mask = np.zeros((h, w), dtype=bool)
    for (r, g, b) in tons:
        delta_r = np.abs(arr[:, :, 0].astype(np.int16) - r)
        delta_g = np.abs(arr[:, :, 1].astype(np.int16) - g)
        delta_b = np.abs(arr[:, :, 2].astype(np.int16) - b)
        mask |= (delta_r <= tol) & (delta_g <= tol) & (delta_b <= tol)
    return mask


def mascara_de_fundo(mask: np.ndarray) -> np.ndarray:
    """Mantém só as componentes conectadas que TOCAM alguma borda da
    imagem — essas são o fundo real. Manchas internas são descartadas."""
    labels, n = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
    if n == 0:
        return mask
    h, w = mask.shape
    # IDs das componentes que aparecem na borda
    bordas = np.concatenate([
        labels[0, :],  labels[-1, :],
        labels[:, 0],  labels[:, -1],
    ])
    ids_bordas = set(int(i) for i in np.unique(bordas) if i != 0)
    if not ids_bordas:
        return np.zeros_like(mask)
    fundo = np.isin(labels, list(ids_bordas))
    return fundo


def processar(origem: Path, destino: Path) -> tuple[bool, str]:
    if not origem.exists():
        return False, 'origem nao encontrada'

    img = Image.open(origem).convert('RGB')
    arr = np.asarray(img)                   # h x w x 3, uint8
    h, w, _ = arr.shape

    tons = detectar_tons(arr)
    cand = construir_mascara(arr, tons, TOL_TOM)
    candidatos = int(cand.sum())
    fundo = mascara_de_fundo(cand)
    n_fundo = int(fundo.sum())
    n_ilhas = candidatos - n_fundo

    # Constroi RGBA: alpha=0 nos pixels de fundo conectado, opaco no resto
    rgba = np.dstack([arr, np.full((h, w), 255, dtype=np.uint8)])
    rgba[fundo, 3] = 0

    img_rgba = Image.fromarray(rgba, mode='RGBA')
    bbox = img_rgba.getbbox()
    if bbox is None:
        return False, 'imagem ficou completamente transparente'
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - MARGEM_BBOX)
    y0 = max(0, y0 - MARGEM_BBOX)
    x1 = min(w, x1 + MARGEM_BBOX)
    y1 = min(h, y1 + MARGEM_BBOX)
    recortada = img_rgba.crop((x0, y0, x1, y1))

    destino.parent.mkdir(parents=True, exist_ok=True)
    recortada.save(destino, 'PNG', optimize=True)
    nw, nh = recortada.size
    pct = (n_fundo * 100) // (w * h) if w * h > 0 else 0
    return True, (f'fundo {n_fundo:,}px ({pct}%) · ilhas restauradas {n_ilhas:,}px · '
                  f'saida {nw}x{nh}')


def main() -> int:
    print('Processando mascotes (mask + connected components + crop)')
    print(f'  origem:  {ORIGEM}')
    print(f'  destino: {DESTINO}')
    print(f'  tol={TOL_TOM}  n_tons={N_TONS}  margem={MARGEM_BBOX}')
    print()
    falhas = 0
    for src, dst in ARQUIVOS:
        ok, msg = processar(ORIGEM / src, DESTINO / dst)
        marca = 'OK ' if ok else 'ERR'
        print(f'  [{marca}] {src:32s} -> {dst:32s}')
        print(f'         {msg}')
        if not ok:
            falhas += 1
    print()
    print(f'Concluido. {len(ARQUIVOS) - falhas}/{len(ARQUIVOS)} arquivos processados.')
    return 0 if falhas == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
