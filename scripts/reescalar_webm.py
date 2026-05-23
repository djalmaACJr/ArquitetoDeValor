"""
Re-encoda os WebMs de mascote-andando.webm reduzindo a resolução pra
metade (720x1280 -> 360x640) e mantendo o alpha (yuva420p). Reduz o
tamanho do arquivo sem perda visual perceptível em telas pequenas
(<= ~250px de altura no display).
"""
from pathlib import Path
import subprocess
import shutil
import imageio_ffmpeg

DIR = Path("FrontEnd/public/mascotes")
MASCOTES = ["sabio", "arquiteta", "gato", "raposa"]

# Resolução alvo (deve manter o aspect ratio do original 720x1280 = 9:16)
ALVO_W = 360
ALVO_H = 640


def main() -> None:
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    for nome in MASCOTES:
        src = DIR / f"{nome}-andando.webm"
        if not src.exists():
            print(f"AVISO: {src} não existe, pulando.")
            continue
        tmp = DIR / f"{nome}-andando.tmp.webm"
        cmd = [
            ff, "-y",
            "-i", str(src),
            "-vf", f"scale={ALVO_W}:{ALVO_H}:flags=lanczos",
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuva420p",
            "-b:v", "0", "-crf", "34",
            "-auto-alt-ref", "0",
            "-an",
            str(tmp),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"ERRO em {nome}: {r.stderr[-300:]}")
            continue
        tam_antes = src.stat().st_size // 1024
        tam_depois = tmp.stat().st_size // 1024
        shutil.move(str(tmp), str(src))
        print(f"OK {nome}-andando.webm  {tam_antes} KB -> {tam_depois} KB "
              f"({(1 - tam_depois/tam_antes)*100:.0f}% menor)")


if __name__ == "__main__":
    main()
