// src/components/ui/FormCamposCategoria.tsx
//
// Campos reutilizáveis do formulário de categoria — sem container.
// Centraliza: estado, validação e layout dos campos.
//
// Usado por:
//   • CategoriasPage       — dentro do Drawer (cria e edita)
//   • ModalNovaCategoriaRapida — dentro do modal (cria apenas)

import {
  Field, Input, SelectDark, Segmented,
  ColorPicker, IconPicker, PreviewBadge, Toggle,
} from './shared'
import type { Categoria } from '../../types'

// ── Tipos exportados ─────────────────────────────────────────────
export type FormCategoriaState = {
  descricao: string
  nivel:     'pai' | 'sub'
  id_pai:    string
  icone:     string
  cor:       string
  ativa:     boolean
}

export const FORM_CATEGORIA_VAZIO: FormCategoriaState = {
  descricao: '', nivel: 'pai', id_pai: '', icone: '🏠', cor: '#00c896', ativa: true,
}

/** Preenche o formulário a partir de uma categoria existente (modo edição). */
export function formDeCategoriaExistente(c: Categoria): FormCategoriaState {
  return {
    descricao: c.descricao,
    nivel:     c.id_pai ? 'sub' : 'pai',
    id_pai:    c.id_pai ?? '',
    icone:     c.icone  ?? '🏠',
    cor:       c.cor    ?? '#00c896',
    ativa:     c.ativa,
  }
}

/**
 * Valida o formulário.
 * Retorna a mensagem de erro, ou null se tudo estiver válido.
 * Centraliza as regras para evitar duplicação entre telas.
 */
export function validarFormCategoria(form: FormCategoriaState): string | null {
  if (!form.descricao.trim()) return 'Descrição é obrigatória.'
  if (form.descricao.trim().length > 50) return 'Descrição deve ter no máximo 50 caracteres.'
  if (form.nivel === 'sub' && !form.id_pai) return 'Selecione a categoria pai.'
  return null
}

// ── Props ────────────────────────────────────────────────────────
interface FormCamposCategoriaProps {
  form:            FormCategoriaState
  onChange:        (partial: Partial<FormCategoriaState>) => void
  /** Categorias disponíveis para escolha de pai (já filtradas/ordenadas pelo caller). */
  categoriasPai:   { id: string; descricao: string; icone: string | null; protegida?: boolean }[]
  /** ID da categoria em edição — excluída do select de pai (evita loop). */
  editandoId?:     string | null
  /** Exibe o toggle Ativa/Inativa — ative apenas no modo de edição. */
  mostrarAtiva?:   boolean
  /** Mensagem de erro a exibir abaixo dos campos. */
  erro?:           string | null
}

// ── Componente ───────────────────────────────────────────────────
export default function FormCamposCategoria({
  form,
  onChange,
  categoriasPai,
  editandoId  = null,
  mostrarAtiva = false,
  erro         = null,
}: FormCamposCategoriaProps) {
  const set = (p: Partial<FormCategoriaState>) => onChange(p)

  const paisDisponiveis = categoriasPai.filter(
    p => !p.protegida && p.id !== editandoId,
  )

  return (
    <>
      {/* Nível: pai / subcategoria */}
      <Field label="Nível" data-tutorial="cat-nivel">
        <Segmented
          opcoes={[
            { value: 'pai', label: 'Categoria pai' },
            { value: 'sub', label: 'Subcategoria'  },
          ]}
          value={form.nivel}
          onChange={v => set({ nivel: v as 'pai' | 'sub', id_pai: '' })}
        />
      </Field>

      {/* Categoria pai (apenas quando nivel = sub) */}
      {form.nivel === 'sub' && (
        <Field label="Categoria pai *">
          <SelectDark value={form.id_pai} onChange={e => set({ id_pai: e.target.value })}>
            <option value="">Selecione...</option>
            {paisDisponiveis.map(p => (
              <option key={p.id} value={p.id}
                style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                {p.icone ?? ''} {p.descricao}
              </option>
            ))}
          </SelectDark>
        </Field>
      )}

      {/* Descrição */}
      <Field label="Descrição *" data-tutorial="cat-descricao">
        <div className="relative">
          <Input
            value={form.descricao}
            onChange={e => set({ descricao: e.target.value })}
            placeholder="Ex: Alimentação"
            maxLength={50}
          />
          <span
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[14px]"
            style={{ color: '#8b92a8' }}>
            {form.descricao.length}/50
          </span>
        </div>
      </Field>

      {/* Ícone */}
      <Field label="Ícone" data-tutorial="cat-icone">
        <IconPicker value={form.icone} onChange={v => set({ icone: v })} />
      </Field>

      {/* Cor */}
      <Field label="Cor">
        <ColorPicker value={form.cor} onChange={v => set({ cor: v })} />
      </Field>

      {/* Status — apenas modo edição */}
      {mostrarAtiva && (
        <Field label="Status">
          <Toggle
            checked={form.ativa}
            onChange={v => set({ ativa: v })}
            label={form.ativa ? 'Ativa' : 'Inativa'}
          />
        </Field>
      )}

      {/* Pré-visualização */}
      <Field label="Pré-visualização" data-tutorial="cat-preview">
        <PreviewBadge
          icone={form.icone}
          label={form.descricao || 'Nova categoria'}
          cor={form.cor}
        />
      </Field>

      {/* Erro */}
      {erro && (
        <p className="text-[16px] bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"
          style={{ color: '#f87171' }}>
          {erro}
        </p>
      )}
    </>
  )
}
