import { useState } from 'react'
import {
  Drawer, Field, BtnSalvar, BtnCancelar, ColorPicker, IconPicker, SelectDark,
} from './shared'
import { SearchableSelect } from './shared'
import { MultiSelect } from './MultiSelect'
import { useContas } from '../../hooks/useContas'
import { useCategorias } from '../../hooks/useCategorias'
import type { Objetivo, TipoObjetivo, Frequencia } from '../../types'
import type { CriarObjetivoInput, EditarObjetivoInput } from '../../hooks/useObjetivos'

interface FormState {
  tipo:                TipoObjetivo
  nome:                string
  descricao:           string
  icone:               string
  cor:                 string
  valor_meta:          string
  data_inicio:         string
  data_fim:            string
  contas_sonho:        string[] // SONHO: múltiplas contas
  conta_id:            string   // compat leitura
  categoria_id:        string   // PROJETO: filtro opcional
  categorias_objetivo: string[] // OBJETIVO: múltiplas categorias
  frequencia:          string
  contas_projeto:      string[]
}

const VAZIO: FormState = {
  tipo: 'SONHO', nome: '', descricao: '', icone: '🎯', cor: '#4da6ff',
  valor_meta: '', data_inicio: '', data_fim: '',
  contas_sonho: [], conta_id: '', categoria_id: '', categorias_objetivo: [],
  frequencia: '', contas_projeto: [],
}

const TIPO_OPCOES: { value: TipoObjetivo; label: string; desc: string }[] = [
  { value: 'SONHO',       label: '💭 Sonho',       desc: 'Meta de saldo numa conta'          },
  { value: 'OBJETIVO',    label: '🎯 Objetivo',    desc: 'Receita recorrente por categoria'  },
  // PROJETO oculto por hora — desenvolvimento futuro.
  // { value: 'PROJETO',     label: '📦 Projeto',     desc: 'Orçamento de despesas'             },
  { value: 'CRESCIMENTO', label: '📈 Crescimento', desc: '% de crescimento de receitas'      },
]

function de(o: Objetivo): FormState {
  const catsObj = o.categorias_objetivo?.length
    ? o.categorias_objetivo
    : (o.categoria_id ? [o.categoria_id] : [])
  const contasSonho = o.contas_sonho?.length
    ? o.contas_sonho
    : (o.conta_id ? [o.conta_id] : [])
  return {
    tipo:                o.tipo,
    nome:                o.nome,
    descricao:           o.descricao ?? '',
    icone:               o.icone,
    cor:                 o.cor,
    valor_meta:          String(o.valor_meta),
    data_inicio:         o.data_inicio,
    data_fim:            o.data_fim,
    contas_sonho:        contasSonho,
    conta_id:            o.conta_id       ?? '',
    categoria_id:        o.categoria_id   ?? '',
    categorias_objetivo: catsObj,
    frequencia:          o.frequencia     ?? '',
    contas_projeto:      o.contas_projeto ?? [],
  }
}

export function DrawerObjetivo({
  open,
  objetivo,
  onClose,
  onSalvar,
}: {
  open:      boolean
  objetivo:  Objetivo | null
  onClose:   () => void
  onSalvar:  (payload: CriarObjetivoInput | EditarObjetivoInput, id?: string) => Promise<{ ok: boolean; erro: string | null }>
}) {
  const [form,     setForm]     = useState<FormState>(VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erro,     setErro]     = useState<string | null>(null)

  const { contas }     = useContas()
  const { categorias } = useCategorias()

  // Reinicializa o form quando o drawer abre ou troca de objetivo. Padrão
  // "ajustar estado na renderização" (React docs) — evita setState em efeito.
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevObjetivo, setPrevObjetivo] = useState(objetivo)
  if (open !== prevOpen || objetivo !== prevObjetivo) {
    setPrevOpen(open)
    setPrevObjetivo(objetivo)
    if (open) { setForm(objetivo ? de(objetivo) : VAZIO); setErro(null) }
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  // Opções para selects — contas sem icone (pode ser URL, não renderiza bem)
  const optsContasMulti = contas
    .filter(c => c.ativa)
    .map(c => ({ value: c.conta_id, label: c.nome }))

  // Categorias — padrão do projeto (flat com idPai para pai/filho)
  const catsPai = categorias.filter(c => !c.id_pai && !c.protegida && c.ativa)
  const catsSub = categorias.filter(c => !!c.id_pai && c.ativa)

  const optsCats = categorias.flatMap(pai => [
    { id: pai.id, label: pai.descricao, icone: pai.icone ?? undefined },
    ...(pai.subcategorias ?? []).map(f => ({
      id: f.id, label: f.descricao, icone: f.icone ?? undefined,
      sublabel: pai.descricao, idPai: pai.id,
    })),
  ])

  const optsCatsMulti = catsPai.flatMap(pai => [
    { value: pai.id, label: pai.descricao, icone: pai.icone ?? undefined },
    ...catsSub.filter(f => f.id_pai === pai.id).map(f => ({
      value: f.id, label: f.descricao, icone: f.icone ?? undefined,
      grupo: pai.descricao, idPai: pai.id,
    })),
  ])

  async function salvar() {
    setErro(null)
    const valorMeta = parseFloat(form.valor_meta.replace(',', '.'))
    if (!form.nome.trim())       return setErro('Nome é obrigatório')
    if (!valorMeta || valorMeta <= 0) return setErro('Valor da meta deve ser maior que 0')
    if (!form.data_inicio)       return setErro('Data de início é obrigatória')
    if (!form.data_fim)          return setErro('Data de término é obrigatória')
    if (form.data_fim < form.data_inicio) return setErro('Data de término deve ser após a de início')
    if (form.tipo === 'SONHO' && form.contas_sonho.length === 0)
      return setErro('Selecione ao menos uma conta para o Sonho')
    if ((form.tipo === 'OBJETIVO' || form.tipo === 'CRESCIMENTO') && form.categorias_objetivo.length === 0)
      return setErro('Selecione ao menos uma categoria')
    if (form.tipo === 'PROJETO' && form.contas_projeto.length === 0)
      return setErro('Selecione ao menos uma conta para o Projeto')

    const base = {
      nome:                form.nome.trim(),
      descricao:           form.descricao.trim() || null,
      icone:               form.icone,
      cor:                 form.cor,
      valor_meta:          valorMeta,
      data_inicio:         form.data_inicio,
      data_fim:            form.data_fim,
      // SONHO usa array; conta_id = primeira conta para compat com view
      contas_sonho:        form.tipo === 'SONHO' ? form.contas_sonho : [],
      conta_id:            form.tipo === 'SONHO' ? (form.contas_sonho[0] ?? null) : null,
      // OBJETIVO e CRESCIMENTO usam categorias_objetivo; PROJETO mantém categoria_id opcional
      categoria_id:        (form.tipo === 'OBJETIVO' || form.tipo === 'CRESCIMENTO') ? null : (form.categoria_id || null),
      categorias_objetivo: (form.tipo === 'OBJETIVO' || form.tipo === 'CRESCIMENTO') ? form.categorias_objetivo : [],
      frequencia:          (form.tipo !== 'CRESCIMENTO' && form.frequencia) ? (form.frequencia as Frequencia) : null,
      contas_projeto:      form.contas_projeto,
    }

    setSalvando(true)
    const res = await onSalvar(
      objetivo ? base : { ...base, tipo: form.tipo },
      objetivo?.id,
    )
    setSalvando(false)
    if (res.ok) onClose()
    else setErro(res.erro ?? 'Erro ao salvar')
  }

  const editando = !!objetivo
  const titulo   = editando ? 'Editar objetivo' : 'Novo objetivo'

  return (
    <Drawer open={open} onClose={onClose} titulo={titulo}
      rodape={<><BtnSalvar editando={editando} onClick={salvar} salvando={salvando}/><BtnCancelar onClick={onClose}/></>}>

      {/* Tipo (só na criação) */}
      {!editando && (
        <Field label="Tipo" data-tutorial="objetivo-tipo">
          <div className="grid grid-cols-2 gap-2">
            {TIPO_OPCOES.map(op => (
              <button key={op.value} onClick={() => set('tipo', op.value)}
                className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl border text-center transition-all
                  ${form.tipo === op.value
                    ? 'border-av-green bg-av-green/10 text-white'
                    : 'border-white/10 text-white/50 hover:border-white/25'}`}>
                <span className="text-[15px] font-medium">{op.label}</span>
                <span className="text-[11px] leading-tight" style={{ color: form.tipo === op.value ? '#8b92a8' : undefined }}>
                  {op.desc}
                </span>
              </button>
            ))}
          </div>
        </Field>
      )}

      {/* Nome */}
      <Field label="Nome" data-tutorial="objetivo-nome">
        <input value={form.nome} onChange={e => set('nome', e.target.value)} maxLength={100}
          placeholder={form.tipo === 'CRESCIMENTO' ? 'Ex.: Crescimento de renda em 10%' : 'Ex.: Fundo de emergência'}
          className="w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2 text-[15px]
            outline-none focus:border-av-green transition-colors"
          style={{ color: '#e8eaf0' }} />
      </Field>

      {/* Valor meta — R$ para os demais, % para CRESCIMENTO */}
      <Field label={form.tipo === 'CRESCIMENTO' ? 'Meta de crescimento (%)' : 'Valor da meta (R$)'} data-tutorial="objetivo-meta">
        <div className="relative">
          <input value={form.valor_meta} onChange={e => set('valor_meta', e.target.value)}
            type="number"
            min={form.tipo === 'CRESCIMENTO' ? '0.1' : '0.01'}
            step={form.tipo === 'CRESCIMENTO' ? '0.1'  : '0.01'}
            placeholder={form.tipo === 'CRESCIMENTO' ? '10' : '0,00'}
            className="w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2 text-[15px]
              outline-none focus:border-av-green transition-colors pr-10"
            style={{ color: '#e8eaf0' }} />
          {form.tipo === 'CRESCIMENTO' && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[14px] select-none"
              style={{ color: '#8b92a8' }}>%</span>
          )}
        </div>
        {form.tipo === 'CRESCIMENTO' && (
          <p className="text-[12px] mt-1" style={{ color: '#8b92a8' }}>
            Quanto as receitas devem crescer em relação ao ano base (1º ano do período).
          </p>
        )}
      </Field>

      {/* Período */}
      <div className="grid grid-cols-2 gap-3" data-tutorial="objetivo-periodo">
        <Field label="Data início">
          <input type="date" value={form.data_inicio} onChange={e => set('data_inicio', e.target.value)}
            className="w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2 text-[15px]
              outline-none focus:border-av-green transition-colors"
            style={{ color: '#e8eaf0', colorScheme: 'dark' }} />
        </Field>
        <Field label="Data término">
          <input type="date" value={form.data_fim} onChange={e => set('data_fim', e.target.value)}
            className="w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2 text-[15px]
              outline-none focus:border-av-green transition-colors"
            style={{ color: '#e8eaf0', colorScheme: 'dark' }} />
        </Field>
      </div>

      {/* Campos por tipo */}
      {form.tipo === 'SONHO' && (
        <Field label="Contas monitoradas" data-tutorial="objetivo-alvo">
          <MultiSelect options={optsContasMulti} values={form.contas_sonho}
            onChange={v => set('contas_sonho', v)} placeholder="Selecione as contas…" />
        </Field>
      )}

      {form.tipo === 'OBJETIVO' && (
        <>
          <Field label="Categorias de receita (pode selecionar várias)" data-tutorial="objetivo-alvo">
            <MultiSelect
              options={optsCatsMulti}
              values={form.categorias_objetivo}
              onChange={v => set('categorias_objetivo', v)}
              placeholder="Selecione as categorias…"
            />
          </Field>
          <Field label="Frequência (opcional)">
            <SelectDark value={form.frequencia} onChange={e => set('frequencia', e.target.value)}>
              <option value="">Sem frequência</option>
              <option value="MENSAL">Mensal</option>
              <option value="ANUAL">Anual</option>
              <option value="SEMANAL">Semanal</option>
              <option value="DIARIA">Diária</option>
            </SelectDark>
          </Field>
        </>
      )}

      {(form.tipo === 'CRESCIMENTO') && (
        <Field label="Categorias de receita a monitorar" data-tutorial="objetivo-alvo">
          <MultiSelect
            options={optsCatsMulti}
            values={form.categorias_objetivo}
            onChange={v => set('categorias_objetivo', v)}
            placeholder="Selecione as categorias…"
          />
        </Field>
      )}

      {form.tipo === 'PROJETO' && (
        <>
          <Field label="Contas do projeto">
            <MultiSelect options={optsContasMulti} values={form.contas_projeto}
              onChange={v => set('contas_projeto', v)} placeholder="Selecione as contas…" />
          </Field>
          <Field label="Categoria (opcional)">
            <SearchableSelect opcoes={[{ id: '', label: 'Todas as categorias' }, ...optsCats]}
              value={form.categoria_id} onChange={v => set('categoria_id', v)}
              placeholder="Filtrar por categoria…" />
          </Field>
        </>
      )}

      {/* Ícone e cor */}
      <Field label="Ícone" data-tutorial="objetivo-icone">
        <IconPicker value={form.icone} onChange={v => set('icone', v)} />
      </Field>
      <Field label="Cor">
        <ColorPicker value={form.cor} onChange={v => set('cor', v)} />
      </Field>

      {/* Descrição */}
      <Field label="Descrição (opcional)">
        <textarea value={form.descricao} onChange={e => set('descricao', e.target.value)}
          rows={2} maxLength={500} placeholder="Observações sobre o objetivo…"
          className="w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2 text-[15px]
            outline-none focus:border-av-green transition-colors resize-none"
          style={{ color: '#e8eaf0' }} />
      </Field>

      {erro && <p className="text-[13px] text-red-400 text-center">{erro}</p>}
    </Drawer>
  )
}
