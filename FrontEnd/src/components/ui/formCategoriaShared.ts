// src/components/ui/formCategoriaShared.ts
//
// Tipos, valor padrão e validação do formulário de categoria.
// Extraído de FormCamposCategoria.tsx pra que aquele arquivo só
// exporte o componente — exigido pelo `react-refresh/only-export-components`.

import type { Categoria } from '../../types'

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
 */
export function validarFormCategoria(form: FormCategoriaState): string | null {
  if (!form.descricao.trim()) return 'Descrição é obrigatória.'
  if (form.descricao.trim().length > 50) return 'Descrição deve ter no máximo 50 caracteres.'
  if (form.nivel === 'sub' && !form.id_pai) return 'Selecione a categoria pai.'
  return null
}
