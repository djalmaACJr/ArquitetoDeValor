"""
Remove fundo branco de WebMs e PNGs preservando os brancos INTERIORES
(barba/camisa/etc do mascote).

Algoritmo:
  1. Identifica pixels "brancos" (R,G,B todos > 235)
  2. Flood-fill a partir da borda da imagem através do conjunto branco
     → pixels alcançados = fundo (a serem transparentados)
  3. Pixels brancos NÃO alcançados (cercados por não-brancos) = interior
     → permanecem opacos (alpha 255, RGB branco)
  4. Demais pixels (não-brancos) = opacos, RGB original

Uso:
    python scripts/remover_fundo_branco.py <arquivo>
    python scripts/remover_fundo_branco.py FrontEnd/public/mascotes/sabio-comprimentando.webm
    python scripts/remover_fundo_branco.py FrontEnd/public/mascotes/sabio-curioso.png

Suporta .webm (VP9 com alpha) e .png. Para webm, extrai cada frame,
processa, e re-encoda. Para png, processa direto.
"""
from __future__ import annotations
import sys
import os
import subprocess
import tempfile
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import label
import imageio_ffmpeg


LIMIAR_BRANCO    = 235   # R,G,B todos >= isto = considerado "branco"
LIMIAR_OPACO     = 200   # entre LIMIAR_OPACO e LIMIAR_BRANCO = alpha proporcional (borda suave)


def processar_frame(rgba: np.ndarray) -> np.ndarray:
    """Recebe frame RGBA, retorna RGBA com fundo transparente e
    brancos interiores preservados (opacos)."""
    rgb = rgba[:, :, :3]
    h, w = rgba.shape[:2]

    # Máscara binária de "branco" (todos os 3 canais acima do limiar)
    is_white = (rgb[:, :, 0] >= LIMIAR_BRANCO) & \
               (rgb[:, :, 1] >= LIMIAR_BRANCO) & \
               (rgb[:, :, 2] >= LIMIAR_BRANCO)

    # Componentes conectados de "branco" (8-conectividade)
    structure = np.ones((3, 3), dtype=int)
    labels, _ = label(is_white, structure=structure)

    # Componentes que tocam a borda da imagem
    border_labels: set[int] = set()
    border_labels.update(labels[0,  :].tolist())
    border_labels.update(labels[-1, :].tolist())
    border_labels.update(labels[:,  0].tolist())
    border_labels.update(labels[:, -1].tolist())
    border_labels.discard(0)  # 0 = não-branco, ignorar

    # Máscara: True se pixel é branco-de-fundo (componente que toca a borda)
    bg_mask = np.isin(labels, list(border_labels)) if border_labels else np.zeros((h, w), dtype=bool)

    # Constrói RGBA resultado
    out = rgba.copy()
    # Brancos de fundo → transparentes
    out[bg_mask, 3] = 0
    # Brancos interiores → opacos puros (RGB=255, alpha=255)
    interior_white = is_white & ~bg_mask
    out[interior_white, :3] = 255
    out[interior_white, 3]  = 255
    # Demais pixels → forçar opaco (alpha 255) — preserva detalhe
    # (mas só se não estamos sobrescrevendo bg_mask)
    nao_bg = ~bg_mask
    nao_branco_nao_bg = nao_bg & ~is_white
    out[nao_branco_nao_bg, 3] = 255

    return out


def processar_png(caminho: Path) -> None:
    src_im = Image.open(caminho).convert("RGBA")
    arr = np.array(src_im)
    novo = processar_frame(arr)
    Image.fromarray(novo, "RGBA").save(caminho, optimize=True)
    sz = caminho.stat().st_size // 1024
    print(f"OK {caminho.name}  {arr.shape[1]}x{arr.shape[0]}  ({sz} KB)")


def processar_webm(caminho: Path) -> None:
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    tmp_dir = Path(tempfile.mkdtemp(prefix="bgremove_"))
    try:
        # 1. Extrai frames
        print(f"[{caminho.name}] extraindo frames...")
        r = subprocess.run([
            ff, "-y", "-i", str(caminho),
            "-vf", "format=rgba",
            "-an",
            str(tmp_dir / "frame_%04d.png"),
        ], capture_output=True, text=True)
        if r.returncode != 0:
            print("ERRO extraindo:", r.stderr[-500:])
            return

        frames = sorted(tmp_dir.glob("frame_*.png"))
        if not frames:
            print("ERRO: nenhum frame extraído")
            return
        print(f"[{caminho.name}] {len(frames)} frames extraídos")

        # 2. Detecta fps original
        r2 = subprocess.run([ff, "-i", str(caminho)], capture_output=True, text=True)
        import re
        m = re.search(r"(\d+(?:\.\d+)?)\s*fps", r2.stderr)
        fps = m.group(1) if m else "24"

        # 3. Processa cada frame
        print(f"[{caminho.name}] processando frames...")
        for f in frames:
            arr = np.array(Image.open(f).convert("RGBA"))
            novo = processar_frame(arr)
            Image.fromarray(novo, "RGBA").save(f, optimize=False)

        # 4. Re-encoda com VP9 + alpha
        print(f"[{caminho.name}] re-encodando...")
        tmp_out = caminho.with_suffix(".tmp.webm")
        r = subprocess.run([
            ff, "-y",
            "-framerate", fps,
            "-i", str(tmp_dir / "frame_%04d.png"),
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuva420p",
            "-b:v", "0", "-crf", "34",
            "-auto-alt-ref", "0",
            "-an",
            str(tmp_out),
        ], capture_output=True, text=True)
        if r.returncode != 0:
            print("ERRO re-encodando:", r.stderr[-500:])
            return

        sz_in  = caminho.stat().st_size // 1024
        sz_out = tmp_out.stat().st_size // 1024
        os.replace(tmp_out, caminho)
        print(f"OK {caminho.name}  {sz_in} KB -> {sz_out} KB")

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("uso: remover_fundo_branco.py <arquivo.webm|.png> [<arquivo2> ...]")
    for arg in sys.argv[1:]:
        p = Path(arg)
        if not p.exists():
            print(f"AVISO: {p} não existe")
            continue
        if p.suffix.lower() == ".png":
            processar_png(p)
        elif p.suffix.lower() == ".webm":
            processar_webm(p)
        else:
            print(f"AVISO: {p} - extensão não suportada (use .png ou .webm)")


if __name__ == "__main__":
    main()
