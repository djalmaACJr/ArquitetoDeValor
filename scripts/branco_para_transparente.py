#!/usr/bin/env python3
"""
Converte o fundo BRANCO dos PNGs dos mascotes em transparência.

Estratégia:
  1. Considera "branco" todo pixel cujos 3 canais estão acima de 240.
  2. scipy.ndimage.label → mantém só componentes que TOCAM a borda da
     imagem (essas são o fundo real). Manchas brancas dentro do
     personagem (camisa do Sábio, etc.) NÃO viram transparentes.
  3. Em volta da silhueta, aplica antialiasing suave: pixels "quase
     brancos" próximos ao fundo viram parcialmente transparentes (alpha
     proporcional). Sem isso, o recorte fica com borda dura "serrilhada".
  4. Recorta a bounding box do que ficou opaco + margem.

Roda sobre `FrontEnd/public/mascotes/*.png` in-place — espera arquivos
já criados pelo usuário. Faz backup em `FrontEnd/public/mascotes/_originais/`.

Uso: py scripts/branco_para_transparente.py
"""

from pathlib import Path
import shutil
from PIL import Image
import numpy as np
from scipy import ndimage

# Pixel considerado "branco" se TODOS os canais R, G, B forem >= LIMIAR_BRANCO.
# Reduzido para 225 — alguns PNGs têm fundo "branco" com leve tom (devido
# a JPEG ancestor ou anti-aliasing do gerador) que ficava acima de 225
# mas abaixo de 240. Capturar pixels mais escuros como fundo evita
# resíduos cinzas claros ao redor do personagem.
LIMIAR_BRANCO = 225

# Faixa de antialiasing: pixels nessa luminância e próximos ao fundo
# ganham transparência proporcional (quanto mais claro, mais transparente).
# Mais ampla pra suavizar bordas e capturar halo claro.
ANTI_INI = 200
ANTI_FIM = 225

# Margem em pixels ao redor da bounding box final.
MARGEM_BBOX = 12

PASTA = Path(__file__).resolve().parent.parent / 'FrontEnd' / 'public' / 'mascotes'
BACKUP = PASTA / '_originais'


def processar_arquivo(caminho: Path) -> tuple[bool, str]:
    img = Image.open(caminho)
    # Converte pra RGBA mas trata a imagem como se estivesse em RGB (a
    # transparência atual, se existir, é descartada).
    rgb = img.convert('RGB')
    arr = np.asarray(rgb)
    h, w, _ = arr.shape

    # 1) Marca pixels "puramente brancos" — também aceita cinza-claros
    # quase neutros (R≈G≈B) com luminância alta, pois alguns geradores
    # produzem leves tons cinza nas bordas.
    r_ch = arr[:, :, 0].astype(np.int16)
    g_ch = arr[:, :, 1].astype(np.int16)
    b_ch = arr[:, :, 2].astype(np.int16)
    quase_neutro = (np.abs(r_ch - g_ch) <= 6) & (np.abs(g_ch - b_ch) <= 6) & (np.abs(r_ch - b_ch) <= 6)
    luminoso = (r_ch >= LIMIAR_BRANCO) & (g_ch >= LIMIAR_BRANCO) & (b_ch >= LIMIAR_BRANCO)
    branco = luminoso | (quase_neutro & ((r_ch + g_ch + b_ch) // 3 >= LIMIAR_BRANCO - 10))

    # 2) Mantém só componentes brancas que TOCAM a borda (fundo real)
    labels, n = ndimage.label(branco, structure=np.ones((3, 3), dtype=np.uint8))
    if n == 0:
        return False, 'nenhum branco encontrado'
    bordas = np.concatenate([
        labels[0, :],  labels[-1, :],
        labels[:, 0],  labels[:, -1],
    ])
    ids_fundo = set(int(i) for i in np.unique(bordas) if i != 0)
    if not ids_fundo:
        return False, 'branco nao toca bordas'
    fundo = np.isin(labels, list(ids_fundo))

    # 2b) Propaga o fundo pelos pixels "claros" conectados (lum > 180 e
    # quase neutros). Isso pega halos cinza-claros das bordas do
    # personagem que escapam do limiar puro de branco, sem invadir
    # cores saturadas do personagem.
    # Propagação: pixels "claros" conectados ao fundo são absorvidos.
    # Conservador: lum ≥ 200 e quase-neutros (Δ canal ≤ 14). Isso pega
    # halos cinza-claros sem comer o antialias dos contornos do
    # personagem (que pode ter cores levemente saturadas).
    claros = (
        ((r_ch + g_ch + b_ch) // 3 >= 200)
        & (np.abs(r_ch - g_ch) <= 14)
        & (np.abs(g_ch - b_ch) <= 14)
        & (np.abs(r_ch - b_ch) <= 14)
    )
    # `binary_propagation`: expande `fundo` por toda região conectada de
    # `claros`. Pixels claros que NÃO se conectam ao fundo (ex.: cabelo
    # branco do Sábio dentro do personagem) ficam preservados.
    fundo = ndimage.binary_propagation(
        input=fundo,
        mask=fundo | claros,
        structure=np.ones((3, 3), dtype=bool),
    )

    # 2c) Bolsões brancos INTERNOS isolados — espaço entre pernas, vão
    # entre patas, etc. Ficam separados do fundo externo pelo contorno
    # escuro do personagem.
    #
    # Estratégia: pega componentes conexos de pixels PUROS BRANCOS que
    # não foram capturados como fundo. Os componentes PEQUENOS (até 4%
    # do fundo principal) viram fundo também — esses são os bolsões
    # entre pernas. Componentes grandes (camisa branca do Sábio, barriga
    # branca da Raposa) ficam preservados.
    if fundo.sum() > 0:
        restantes = branco & ~fundo
        if restantes.any():
            lbl, nb = ndimage.label(restantes, structure=np.ones((3, 3), dtype=np.uint8))
            if nb > 0:
                tamanhos = np.bincount(lbl.ravel())
                tamanhos[0] = 0
                # Limite: 7% do fundo principal — bolsões entre pernas
                # raramente passam disso; features brancas legítimas
                # (barba, camisa) costumam ser maiores e/ou não puramente
                # brancas (a barba do Sábio é cinza claro, não branco
                # puro 240+).
                limite = max(200, int(fundo.sum() * 0.07))
                ids_pocket = np.where((tamanhos >= 20) & (tamanhos <= limite))[0]
                if len(ids_pocket) > 0:
                    fundo = fundo | np.isin(lbl, ids_pocket)
                    # Propaga de novo: bolsão pode ter "claros" anexos
                    # que agora se conectam ao fundo expandido.
                    fundo = ndimage.binary_propagation(
                        input=fundo,
                        mask=fundo | claros,
                        structure=np.ones((3, 3), dtype=bool),
                    )

    # 3) Antialiasing nas bordas: pixels "quase brancos" perto do fundo
    # ganham transparência parcial. Calcula um alpha gradient.
    lum = arr.mean(axis=2)  # luminância média
    alpha = np.full((h, w), 255, dtype=np.uint8)
    alpha[fundo] = 0
    # Faixa antialiasing: pixels com lum em [ANTI_INI, ANTI_FIM) que NÃO
    # são fundo (não foram zerados) mas estão "próximos" do fundo (dilatação).
    proximo_fundo = ndimage.binary_dilation(
        fundo, structure=np.ones((3, 3), dtype=bool), iterations=2,
    ) & ~fundo
    mascara_aa = (lum >= ANTI_INI) & (lum < ANTI_FIM) & proximo_fundo
    if mascara_aa.any():
        # Mapeia lum linearmente: ANTI_INI → 255 opaco, ANTI_FIM → 0 transparente
        rampa = ((ANTI_FIM - lum[mascara_aa]) / (ANTI_FIM - ANTI_INI)) * 255
        alpha[mascara_aa] = np.clip(rampa, 0, 255).astype(np.uint8)

    # Compõe RGBA
    rgba = np.dstack([arr, alpha])
    img_rgba = Image.fromarray(rgba)

    # 4) Recorta bbox + margem
    bbox = img_rgba.getbbox()
    if bbox is None:
        return False, 'imagem ficou completamente transparente'
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - MARGEM_BBOX)
    y0 = max(0, y0 - MARGEM_BBOX)
    x1 = min(w, x1 + MARGEM_BBOX)
    y1 = min(h, y1 + MARGEM_BBOX)
    recortada = img_rgba.crop((x0, y0, x1, y1))
    recortada.save(caminho, 'PNG', optimize=True)

    pct_fundo = int(fundo.sum() * 100 / (h * w)) if h * w > 0 else 0
    nw, nh = recortada.size
    return True, f'fundo {pct_fundo}% · saida {nw}x{nh}'


def main() -> int:
    if not PASTA.is_dir():
        print(f'ERRO: pasta nao existe: {PASTA}')
        return 1

    BACKUP.mkdir(exist_ok=True)
    # Pega só os PNGs dos mascotes (pula login-bg, etc.)
    pngs = sorted(
        p for p in PASTA.glob('*.png')
        if any(p.name.startswith(prefixo) for prefixo in ('sabio-', 'arquiteta-', 'gato-', 'raposa-'))
    )
    if not pngs:
        print('Nenhum PNG de mascote encontrado.')
        return 0

    print(f'Convertendo branco em transparencia ({len(pngs)} arquivos)')
    print(f'  pasta:  {PASTA}')
    print(f'  backup: {BACKUP}')
    print(f'  limiar={LIMIAR_BRANCO}  antialias=[{ANTI_INI},{ANTI_FIM})  margem={MARGEM_BBOX}')
    print()

    falhas = 0
    for p in pngs:
        # Backup do original (se ainda não existir)
        bkp = BACKUP / p.name
        if not bkp.exists():
            shutil.copy2(p, bkp)
        # Sempre reprocessa a partir do backup original — assim ajustes
        # no script podem ser aplicados sem comprometer iterações
        # anteriores que perderam o fundo original.
        if bkp.exists():
            shutil.copy2(bkp, p)
        ok, msg = processar_arquivo(p)
        marca = 'OK ' if ok else 'ERR'
        print(f'  [{marca}] {p.name:32s}  {msg}')
        if not ok:
            falhas += 1
    print()
    print(f'Concluido. {len(pngs) - falhas}/{len(pngs)} arquivos processados.')
    return 0 if falhas == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
