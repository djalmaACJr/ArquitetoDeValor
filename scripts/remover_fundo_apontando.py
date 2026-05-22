"""
Remove fundo dos PNGs de apontamento, detectando a cor de fundo
automaticamente (verde, branco, etc) e preservando partes internas
que tenham cor similar (ex.: barba branca do sabio quando o fundo
foi pintado de verde pra facilitar).

Algoritmo:
  1. Detecta cor de fundo: mediana dos 4 cantos OPACOS
     (ignora cantos que já estão alfa=0)
  2. Identifica pixels "próximos" à cor de fundo (color distance)
  3. Flood-fill a partir da borda da imagem → pixels alcançados via
     conjunto similar-ao-bg = fundo (alpha = 0)
  4. Pixels similares-ao-bg INTERNOS (não alcançados da borda):
     - Se bg é branco: restaura como branco opaco
     - Caso contrário: deixa transparentes também (assume que cor de
       bg só aparece no fundo, não no interior do mascote)
  5. Pixels não-similares-ao-bg: opacos com RGB original

Uso:
  remover_fundo_apontando.py [--tol N] <arquivo1.png> [<arquivo2> ...]
"""
from __future__ import annotations
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import label


# Tolerância padrão (0..441 — distância Euclidiana RGB)
TOLERANCIA = 50


def detectar_bg(arr: np.ndarray) -> np.ndarray:
    """Estima cor de fundo.

    Estratégia: ao longo do anel externo da imagem, considera cada *coluna*
    vertical e cada *linha* horizontal. Pra cada uma, ignora pixels totalmente
    transparentes e pula a moldura (faixa colorida fina nos primeiros pixels
    opacos), registrando o primeiro pixel opaco "estável" — esse é o bg.
    Pega a mediana dessas amostras.
    """
    h, w = arr.shape[:2]
    candidatos: list[np.ndarray] = []

    def primeiro_estavel(linha: np.ndarray) -> np.ndarray | None:
        # linha: (N, 4). Acha o primeiro pixel opaco que tenha vizinhança parecida.
        opaco_idx = np.where(linha[:, 3] > 128)[0]
        if opaco_idx.size < 6:
            return None
        for k in range(opaco_idx.size - 5):
            i = opaco_idx[k]
            vizinhos = linha[i:i+6]
            if (vizinhos[:, 3] > 128).all():
                # estabilidade: desvio padrão baixo
                if vizinhos[:, :3].std(axis=0).max() < 15:
                    return vizinhos[:, :3].mean(axis=0)
        return None

    for col in range(0, w, max(1, w // 40)):
        for sentido in ("topo", "fundo"):
            linha = arr[:, col] if sentido == "topo" else arr[::-1, col]
            v = primeiro_estavel(linha)
            if v is not None:
                candidatos.append(v)
    for row in range(0, h, max(1, h // 40)):
        for sentido in ("esq", "dir"):
            linha = arr[row, :] if sentido == "esq" else arr[row, ::-1]
            v = primeiro_estavel(linha)
            if v is not None:
                candidatos.append(v)

    if not candidatos:
        return np.array([255, 255, 255])
    return np.median(np.array(candidatos), axis=0)


def processar(caminho: Path, tol: float = TOLERANCIA) -> None:
    src = Image.open(caminho).convert("RGBA")
    arr = np.array(src)
    h, w = arr.shape[:2]
    bg = detectar_bg(arr)
    bg_branco = bool(bg[0] > 200 and bg[1] > 200 and bg[2] > 200)

    # Distância euclidiana de cada pixel à cor de fundo
    diff = arr[:, :, :3].astype(np.int32) - bg.astype(np.int32)
    dist = np.sqrt((diff ** 2).sum(axis=2))
    similar_bg = dist < tol

    # Connected components do conjunto "similar ao bg"
    structure = np.ones((3, 3), dtype=int)
    labels, _ = label(similar_bg, structure=structure)

    # Quais componentes tocam a borda
    border_labels: set[int] = set()
    border_labels.update(labels[0,  :].tolist())
    border_labels.update(labels[-1, :].tolist())
    border_labels.update(labels[:,  0].tolist())
    border_labels.update(labels[:, -1].tolist())
    border_labels.discard(0)
    bg_mask = np.isin(labels, list(border_labels)) if border_labels else np.zeros((h, w), dtype=bool)

    # Bordas com transição suave: pixels semi-similares (entre TOL e 1.5*TOL)
    # que estão na borda do bg_mask ganham alpha proporcional
    out = arr.copy()
    out[bg_mask, 3] = 0
    # Demais pixels: opacos com RGB original
    out[~bg_mask, 3] = 255

    # Se bg é branco, restaura brancos internos opacos (ex.: barba do sabio)
    if bg_branco:
        interior_white = similar_bg & ~bg_mask
        out[interior_white, :3] = 255
        out[interior_white, 3]  = 255
    # Se bg NÃO é branco (ex.: verde do sabio), os pixels similares-ao-bg
    # internos também viram transparentes (assume que aquela cor só
    # existia no fundo). Se quisesse preservar, mudar aqui.

    Image.fromarray(out, "RGBA").save(caminho, optimize=True)
    bg_label = "branco" if bg_branco else f"RGB{tuple(int(v) for v in bg)}"
    n_transp = int((out[:, :, 3] == 0).sum())
    pct = 100 * n_transp / (h * w)
    print(f"OK {caminho.name:48} bg={bg_label:18} {w}x{h}  transparente: {pct:.1f}%")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit("uso: remover_fundo_apontando.py [--tol N] <arquivo1.png> [<arquivo2> ...]")
    tol = TOLERANCIA
    if args and args[0] == "--tol":
        if len(args) < 2:
            sys.exit("--tol requer valor")
        tol = float(args[1])
        args = args[2:]
    for arg in args:
        p = Path(arg)
        if not p.exists() or p.suffix.lower() != ".png":
            print(f"AVISO: {p} não é PNG ou não existe")
            continue
        processar(p, tol=tol)


if __name__ == "__main__":
    main()
