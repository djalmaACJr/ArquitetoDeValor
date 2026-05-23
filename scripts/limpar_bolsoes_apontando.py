"""
Limpa bolsões de fundo deixados em PNGs já parcialmente processados.

Caso típico: o flood-fill original não alcançou a área entre as pernas
do mascote porque uma "ponte" antialiased fechou o caminho. Resultado:
um pedaço de fundo (branco/cinza claro) opaco enclausurado pelo mascote.

Algoritmo:
  1. Detecta a cor do fundo amostrando pixels opacos PRÓXIMOS da área
     já transparente (anti-alias da borda externa). Mediana dos pixels
     dentro de um anel de N px ao redor da região alpha=0.
  2. Para cada pixel opaco, calcula distância da cor de bg. Se for
     similar (dist < tol), marca pra virar transparente.
  3. Aplica também a pixels "muito claros" (>240 em todos os canais)
     que tipicamente são bg residual em fundos brancos.
"""
from __future__ import annotations
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, label


TOLERANCIA = 30


def detectar_bg_pelo_alfa(arr: np.ndarray) -> np.ndarray | None:
    """Mediana de pixels opacos imediatamente vizinhos à região alpha=0."""
    a = arr[:, :, 3]
    transp = a == 0
    if not transp.any() or transp.all():
        return None
    # Dilata 2px e pega a borda recém-incluída
    dilated = binary_dilation(transp, iterations=2)
    halo = dilated & ~transp & (a > 200)
    if not halo.any():
        return None
    return np.median(arr[halo, :3], axis=0)


def processar(caminho: Path, tol: float = TOLERANCIA) -> None:
    img = Image.open(caminho).convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]
    a = arr[:, :, 3]

    bg = detectar_bg_pelo_alfa(arr)
    similar_bg = np.zeros((h, w), dtype=bool)
    if bg is not None:
        diff = arr[:, :, :3].astype(np.int32) - bg.astype(np.int32)
        dist = np.sqrt((diff ** 2).sum(axis=2))
        similar_bg = (dist < tol) & (a > 128)

    # Também trata pixels muito brancos (fundos brancos residuais)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    quase_branco = (r > 235) & (g > 235) & (b > 235) & (a > 128)

    # Combina: pixel candidato a virar transparente
    candidato = similar_bg | quase_branco

    if not candidato.any():
        print(f"-- {caminho.name}: nada a limpar")
        return

    # Só mata componentes que TOCAM (dentro de 3px) a área já transparente.
    # Isso preserva manchas brancas internas do mascote (ex.: barriga da raposa)
    # que NÃO estão conectadas ao fundo externo.
    transp = arr[:, :, 3] == 0
    transp_dil = binary_dilation(transp, iterations=3)
    labels, n = label(candidato, structure=np.ones((3, 3), dtype=int))
    if n == 0:
        print(f"-- {caminho.name}: nada a limpar")
        return
    # Quais labels têm algum pixel próximo de transparente?
    rotulos_validos = np.unique(labels[transp_dil & (labels > 0)])
    alvo = np.isin(labels, rotulos_validos) & (labels > 0)

    out = arr.copy()
    out[alvo, 3] = 0

    n_antes = int((a == 0).sum())
    n_depois = int((out[:, :, 3] == 0).sum())
    delta = n_depois - n_antes
    pct = 100 * delta / (h * w)
    bg_txt = f"RGB{tuple(int(v) for v in bg)}" if bg is not None else "n/d"
    Image.fromarray(out, "RGBA").save(caminho, optimize=True)
    print(f"OK {caminho.name:48} bg-vizinho={bg_txt:18} +{pct:.1f}% transp")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit("uso: limpar_bolsoes_apontando.py [--tol N] <arquivo1.png> [<arquivo2> ...]")
    tol = TOLERANCIA
    if args and args[0] == "--tol":
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
