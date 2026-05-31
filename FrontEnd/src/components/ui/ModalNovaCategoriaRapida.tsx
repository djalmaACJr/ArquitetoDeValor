// src/components/ui/ModalNovaCategoriaRapida.tsx
//
// Modal leve para criar uma categoria sem sair da tela atual.
// Gerencia seu próprio estado de formulário: o pai só recebe
// a categoria criada via onCriada(cat) — ou nada se fechar.
//
// Uso:
//   {ctx && (
//     <ModalNovaCategoriaRapida
//       categoriasPai={catsPai}
//       onCriada={cat => { ... }}
//       onFechar={() => setCtx(null)}
//     />
//   )}
//
// Montar/desmontar pelo pai garante reset automático do estado.

import { useState } from 'react'
import { XCircle } from 'lucide-react'
import { useCategorias } from '../../hooks/useCategorias'
import type { Categoria } from '../../types'
import FormCamposCategoria from './FormCamposCategoria'
import {
  FORM_CATEGORIA_VAZIO,
  validarFormCategoria,
  type FormCategoriaState,
} from './formCategoriaShared'

interface Props {
  /** Lista de categorias pai disponíveis para seleção (sem protegidas). */
  categoriasPai: Categoria[]
  /** Chamado com a categoria recém-criada após salvar com sucesso. */
  onCriada:      (categoria: Categoria) => void
  /** Chamado ao fechar sem criar. */
  onFechar:      () => void
}

export default function ModalNovaCategoriaRapida({
  categoriasPai, onCriada, onFechar,
}: Props) {
  const { criar } = useCategorias()

  const [form,    setForm]    = useState<FormCategoriaState>(FORM_CATEGORIA_VAZIO)
  const [erro,    setErro]    = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const set = (p: Partial<FormCategoriaState>) => setForm(f => ({ ...f, ...p }))

  const salvar = async () => {
    const msg = validarFormCategoria(form)
    if (msg) { setErro(msg); return }

    setSalvando(true)
    setErro(null)

    const r = await criar({
      descricao: form.descricao.trim(),
      id_pai:    form.nivel === 'sub' ? form.id_pai : null,
      icone:     form.icone || undefined,
      cor:       form.cor   || undefined,
    })

    setSalvando(false)

    if (!r.ok || !r.dados) {
      setErro(r.erro ?? 'Erro ao criar categoria.')
      return
    }

    onCriada(r.dados)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[10vh] pb-8 overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onFechar() }}>

      <div
        className="w-full max-w-md rounded-xl border border-white/10 shadow-2xl"
        style={{ background: '#1a1f2e' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="text-[16px] font-semibold" style={{ color: '#e8eaf0' }}>
            Nova categoria
          </h3>
          <button
            onClick={onFechar}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: '#8b92a8' }}>
            <XCircle size={18} />
          </button>
        </div>

        {/* Campos */}
        <div className="px-4 py-4 flex flex-col gap-4">
          <FormCamposCategoria
            form={form}
            onChange={set}
            categoriasPai={categoriasPai}
            mostrarAtiva={false}
            erro={erro}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-white/10">
          <button
            onClick={onFechar}
            className="px-3 py-1.5 text-[14px] rounded-lg border border-white/10 hover:border-white/30 transition-colors"
            style={{ color: '#8b92a8' }}>
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="px-4 py-1.5 text-[14px] font-semibold rounded-lg bg-av-green hover:bg-av-green/90 transition-colors disabled:opacity-50"
            style={{ color: '#0a0f1a' }}>
            {salvando ? 'Salvando…' : 'Criar categoria'}
          </button>
        </div>
      </div>
    </div>
  )
}
