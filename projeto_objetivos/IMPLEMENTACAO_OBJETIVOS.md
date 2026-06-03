# 🛠️ Guia de Implementação Passo-a-Passo — Módulo de Objetivos

> Instruções detalhadas para implementar cada fase do módulo. Segue padrões de [CLAUDE.md](./CLAUDE.md).

---

## Fase 1: Fundação (Database + API Básico)

### Passo 1.1: Criar Migration com Schema

**Arquivo:** `supabase/migrations/20260602000001_criar_objetivos.sql`

```sql
-- ============================================================================
-- CRIAR ENUMS
-- ============================================================================

CREATE TYPE arqvalor.tipo_objetivo AS ENUM ('SONHO', 'OBJETIVO', 'PROJETO');
CREATE TYPE arqvalor.status_objetivo AS ENUM ('EM_PROGRESSO', 'ATINGIDO', 'CANCELADO');

-- ============================================================================
-- CRIAR TABELA OBJETIVOS
-- ============================================================================

CREATE TABLE arqvalor.objetivos (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Tipo
    tipo               arqvalor.tipo_objetivo NOT NULL,
    
    -- Dados gerais
    nome               VARCHAR(255) NOT NULL,
    descricao          TEXT,
    icone              VARCHAR(50) DEFAULT 'target',
    cor                VARCHAR(10) DEFAULT 'blue',
    ativo              BOOLEAN DEFAULT true,
    
    -- Meta
    valor_meta         NUMERIC(15,2) NOT NULL CHECK (valor_meta > 0),
    data_inicio        DATE NOT NULL,
    data_fim           DATE NOT NULL CHECK (data_fim >= data_inicio),
    
    -- Referências (depende do tipo)
    conta_id           UUID REFERENCES arqvalor.contas(id) ON DELETE SET NULL,
    categoria_id       UUID REFERENCES arqvalor.categorias(id) ON DELETE SET NULL,
    frequencia         arqvalor.frequencia,  -- MENSAL, TRIMESTRAL, ANUAL
    contas_projeto     UUID[] DEFAULT ARRAY[]::UUID[],
    
    -- Progresso (calculado)
    valor_atingido     NUMERIC(15,2) DEFAULT 0,
    percentual         SMALLINT DEFAULT 0 CHECK (percentual >= 0 AND percentual <= 100),
    status             arqvalor.status_objetivo DEFAULT 'EM_PROGRESSO',
    
    -- Histórico de revisões
    revisoes           JSONB DEFAULT '[]'::JSONB,
    
    -- Auditoria
    criado_em          TIMESTAMP DEFAULT NOW(),
    atualizado_em      TIMESTAMP DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_objetivos_user_id ON arqvalor.objetivos(user_id);
CREATE INDEX idx_objetivos_tipo ON arqvalor.objetivos(tipo);
CREATE INDEX idx_objetivos_status ON arqvalor.objetivos(status);
CREATE INDEX idx_objetivos_data_fim ON arqvalor.objetivos(data_fim);
CREATE INDEX idx_objetivos_conta_id ON arqvalor.objetivos(conta_id);
CREATE INDEX idx_objetivos_categoria_id ON arqvalor.objetivos(categoria_id);

-- ============================================================================
-- RLS - Row Level Security
-- ============================================================================

ALTER TABLE arqvalor.objetivos ENABLE ROW LEVEL SECURITY;

CREATE POLICY objetivos_select ON arqvalor.objetivos
    FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY objetivos_insert ON arqvalor.objetivos
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY objetivos_update ON arqvalor.objetivos
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY objetivos_delete ON arqvalor.objetivos
    FOR DELETE
    USING (user_id = auth.uid());

-- ============================================================================
-- CRIAR TABELA OBJETIVOS_PROGRESSO (snapshots diários)
-- ============================================================================

CREATE TABLE arqvalor.objetivos_progresso (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    objetivo_id      UUID NOT NULL REFERENCES arqvalor.objetivos(id) ON DELETE CASCADE,
    
    data_snapshot    DATE NOT NULL,
    valor_atingido   NUMERIC(15,2) NOT NULL,
    percentual       SMALLINT CHECK (percentual >= 0 AND percentual <= 100),
    
    UNIQUE(objetivo_id, data_snapshot)
);

CREATE INDEX idx_prog_objetivo_data ON arqvalor.objetivos_progresso(objetivo_id, data_snapshot DESC);

ALTER TABLE arqvalor.objetivos_progresso ENABLE ROW LEVEL SECURITY;

CREATE POLICY prog_select ON arqvalor.objetivos_progresso
    FOR SELECT
    USING (objetivo_id IN (SELECT id FROM arqvalor.objetivos WHERE user_id = auth.uid()));

CREATE POLICY prog_insert ON arqvalor.objetivos_progresso
    FOR INSERT
    WITH CHECK (objetivo_id IN (SELECT id FROM arqvalor.objetivos WHERE user_id = auth.uid()));

-- ============================================================================
-- FUNÇÃO: Calcular Progresso por Tipo
-- ============================================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_calcular_progresso_objetivo(p_objetivo_id UUID)
RETURNS RECORD AS $$
DECLARE
    v_tipo            arqvalor.tipo_objetivo;
    v_valor_atingido  NUMERIC;
    v_percentual      SMALLINT;
    v_status          arqvalor.status_objetivo;
    v_obj_row         arqvalor.objetivos%ROWTYPE;
BEGIN
    SELECT * INTO v_obj_row FROM arqvalor.objetivos WHERE id = p_objetivo_id;
    
    v_tipo := v_obj_row.tipo;
    
    -- ===== SONHO =====
    IF v_tipo = 'SONHO' THEN
        SELECT COALESCE(
            v_obj_row.saldo_inicial + SUM(
                CASE
                    WHEN c.tipo = 'CARTAO' AND t.status = 'PROJECAO' THEN 0
                    WHEN t.tipo = 'RECEITA' THEN t.valor
                    WHEN t.tipo = 'DESPESA' THEN -t.valor
                END
            ), v_obj_row.saldo_inicial
        ) INTO v_valor_atingido
        FROM arqvalor.contas c
        LEFT JOIN arqvalor.transacoes t ON t.conta_id = c.id AND t.data <= CURRENT_DATE
        WHERE c.id = v_obj_row.conta_id;
    
    -- ===== OBJETIVO =====
    ELSIF v_tipo = 'OBJETIVO' THEN
        -- Soma receitas da categoria no período
      -- Soma receitas da categoria no período (PAGO + PENDENTE + PROJECAO pelo status).
      -- tipo permanece RECEITA|DESPESA — não usar PROJECAO como tipo.
      SELECT COALESCE(SUM(t.valor), 0) INTO v_valor_atingido
      FROM arqvalor.transacoes t
      WHERE t.categoria_id = v_obj_row.categoria_id
        AND t.tipo = 'RECEITA'
        AND t.data >= v_obj_row.data_inicio
        AND t.data <= v_obj_row.data_fim;
    
    -- ===== PROJETO =====
    ELSIF v_tipo = 'PROJETO' THEN
      -- Fluxo líquido das contas do projeto (receitas − despesas).
      -- Inclui todos os status (PAGO, PENDENTE, PROJECAO) por data.
      SELECT COALESCE(SUM(
        CASE
          WHEN t.tipo = 'RECEITA' THEN  t.valor
          WHEN t.tipo = 'DESPESA' THEN -t.valor
          ELSE 0
        END
      ), 0) INTO v_valor_atingido
      FROM arqvalor.transacoes t
      WHERE t.conta_id = ANY(v_obj_row.contas_projeto)
        AND t.tipo IN ('RECEITA', 'DESPESA')
        AND t.data >= v_obj_row.data_inicio
        AND t.data <= CURRENT_DATE;
    
    ELSE
        v_valor_atingido := 0;
    END IF;
    
    -- Calcular percentual
    v_percentual := LEAST(100, GREATEST(0, (v_valor_atingido * 100 / v_obj_row.valor_meta)::SMALLINT));
    
    -- Determinar status
    v_status := CASE
        WHEN NOT v_obj_row.ativo THEN 'CANCELADO'
        WHEN v_percentual >= 100 THEN 'ATINGIDO'
        ELSE 'EM_PROGRESSO'
    END;
    
    RETURN ROW(v_valor_atingido, v_percentual, v_status);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER STABLE;

-- ============================================================================
-- TRIGGER: Atualizar Progresso Automaticamente
-- ============================================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_atualizar_progresso_objetivo()
RETURNS TRIGGER AS $$
DECLARE
    v_resultado RECORD;
BEGIN
    v_resultado := arqvalor.fn_calcular_progresso_objetivo(NEW.id);
    
    NEW.valor_atingido := (v_resultado).*[1];
    NEW.percentual := (v_resultado).*[2];
    NEW.status := (v_resultado).*[3];
    NEW.atualizado_em := NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_atualizar_progresso_objetivo
    BEFORE INSERT OR UPDATE ON arqvalor.objetivos
    FOR EACH ROW
    EXECUTE FUNCTION arqvalor.fn_atualizar_progresso_objetivo();

-- ============================================================================
-- Transações vinculadas a Objetivos
-- ============================================================================
-- Recomendação: adicionar coluna opcional em `arqvalor.transacoes`:
--   objetivo_id UUID REFERENCES arqvalor.objetivos(id) ON DELETE SET NULL
-- Não adicionar novo tipo PROJECAO nem campo classificacao — PROJECAO já existe
-- como valor de status_transacao; lançamentos futuros usam status = 'PROJECAO'.
-- Quando uma transação com `objetivo_id` é inserida/atualizada/excluída,
-- um trigger `trg_transacao_atualiza_objetivo` deve chamar
-- `fn_calcular_progresso_objetivo(objetivo_id)` para manter o progresso sincronizado.

-- Exemplo de trigger (esboço):
-- CREATE OR REPLACE FUNCTION arqvalor.fn_transacao_atualiza_objetivo()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.objetivo_id IS NOT NULL THEN
--     PERFORM arqvalor.fn_calcular_progresso_objetivo(NEW.objetivo_id);
--   ELSIF (TG_OP = 'DELETE') AND OLD.objetivo_id IS NOT NULL THEN
--     PERFORM arqvalor.fn_calcular_progresso_objetivo(OLD.objetivo_id);
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- CREATE TRIGGER trg_transacao_atualiza_objetivo
--   AFTER INSERT OR UPDATE OR DELETE ON arqvalor.transacoes
--   FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_transacao_atualiza_objetivo();

-- ============================================================================
-- API: Endpoints para extrato por objetivo
-- ============================================================================
-- - `GET /objetivos/:id/extrato`:
--     Retorna transações onde `objetivo_id = :id` ordenadas por data.
-- - `POST /objetivos/:id/extrato`:
--     Cria `transacoes` com `objetivo_id = :id`. Valida que a conta/categoria
--     pertencem ao usuário e que a classificação é consistente.
-- - `PUT /objetivos/:id/extrato/:transacao_id` e `DELETE`:
--     Permitem edição/exclusão a partir da interface do objetivo.
-- Observação: editar a transação na lista global `/transacoes` deve permitir
-- adicionar/remover `objetivo_id` para vincular/desvincular o lançamento.

-- ============================================================================
-- RPC: Sincronizar Progresso e Criar Snapshots
-- ============================================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_sincronizar_progresso_objetivo(p_user_id UUID)
RETURNS TABLE(objetivos_atualizados INT) AS $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Atualiza todos os objetivos do usuário
    UPDATE arqvalor.objetivos o
    SET 
        valor_atingido = (fn_calcular_progresso_objetivo(o.id)).*[1],
        percentual = (fn_calcular_progresso_objetivo(o.id)).*[2],
        status = (fn_calcular_progresso_objetivo(o.id)).*[3],
        atualizado_em = NOW()
    WHERE o.user_id = p_user_id
      AND o.ativo = true;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    -- Criar snapshots de hoje (se não existir)
    INSERT INTO arqvalor.objetivos_progresso (objetivo_id, data_snapshot, valor_atingido, percentual)
    SELECT 
        o.id,
        CURRENT_DATE,
        o.valor_atingido,
        o.percentual
    FROM arqvalor.objetivos o
    WHERE o.user_id = p_user_id
      AND o.ativo = true
    ON CONFLICT (objetivo_id, data_snapshot) DO NOTHING;
    
    RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- ============================================================================
-- TRIGGER: Atualizar Objetivos quando Transação é Inserida/Atualizada
-- ============================================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_notificar_atualizacao_objetivos()
RETURNS TRIGGER AS $$
BEGIN
    -- Trigger em arqvalor.transacoes que atualiza objetivos relevantes
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE arqvalor.objetivos o
        SET valor_atingido = (arqvalor.fn_calcular_progresso_objetivo(o.id)).*[1],
            percentual = (arqvalor.fn_calcular_progresso_objetivo(o.id)).*[2],
            status = (arqvalor.fn_calcular_progresso_objetivo(o.id)).*[3],
            atualizado_em = NOW()
        WHERE (
            (o.tipo = 'SONHO' AND o.conta_id = NEW.conta_id)
            OR (o.tipo = 'OBJETIVO' AND o.categoria_id = NEW.categoria_id)
            OR (o.tipo = 'PROJETO' AND NEW.conta_id = ANY(o.contas_projeto))
        ) AND o.ativo = true;
    
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE arqvalor.objetivos o
        SET valor_atingido = (arqvalor.fn_calcular_progresso_objetivo(o.id)).*[1],
            percentual = (arqvalor.fn_calcular_progresso_objetivo(o.id)).*[2],
            status = (arqvalor.fn_calcular_progresso_objetivo(o.id)).*[3],
            atualizado_em = NOW()
        WHERE (
            (o.tipo = 'SONHO' AND o.conta_id = OLD.conta_id)
            OR (o.tipo = 'OBJETIVO' AND o.categoria_id = OLD.categoria_id)
            OR (o.tipo = 'PROJETO' AND OLD.conta_id = ANY(o.contas_projeto))
        ) AND o.ativo = true;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Adicionar trigger à tabela transacoes (CREATE TRIGGER se não existir)
-- NOTA: Verificar se já existe antes de criar
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_notificar_atualizacao_objetivos'
        AND tgrelid = 'arqvalor.transacoes'::regclass
    ) THEN
        CREATE TRIGGER trg_notificar_atualizacao_objetivos
            AFTER INSERT OR UPDATE OR DELETE ON arqvalor.transacoes
            FOR EACH ROW
            EXECUTE FUNCTION arqvalor.fn_notificar_atualizacao_objetivos();
    END IF;
END $$;

-- ============================================================================
-- VIEW: Objetivos com Dias Restantes e Info Formatada
-- ============================================================================

CREATE OR REPLACE VIEW arqvalor.vw_objetivos_detalhes
WITH (security_invoker = true)
AS
SELECT
    o.id,
    o.user_id,
    o.tipo,
    o.nome,
    o.descricao,
    o.icone,
    o.cor,
    o.ativo,
    o.valor_meta,
    o.valor_atingido,
    o.percentual,
    o.status,
    o.data_inicio,
    o.data_fim,
    GREATEST(0, EXTRACT(DAY FROM (o.data_fim - CURRENT_DATE))::INT) AS dias_restantes,
    o.conta_id,
    c.nome AS conta_nome,
    o.categoria_id,
    cat.descricao AS categoria_descricao,
    o.frequencia,
    o.contas_projeto,
    o.revisoes,
    o.criado_em,
    o.atualizado_em
FROM arqvalor.objetivos o
LEFT JOIN arqvalor.contas c ON c.id = o.conta_id
LEFT JOIN arqvalor.categorias cat ON cat.id = o.categoria_id;

-- ============================================================================
-- GRANT PERMISSIONS (se necessário)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON arqvalor.objetivos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON arqvalor.objetivos_progresso TO authenticated;
GRANT EXECUTE ON FUNCTION arqvalor.fn_sincronizar_progresso_objetivo TO authenticated;
```

### Passo 1.2: Criar Edge Function `/objetivos`

**Arquivo:** `supabase/functions/objetivos/index.ts`

```ts
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import {
  corsPreFlight,
  json,
  erro,
  db,
  autenticar,
  extrairId,
  extrairAcao,
  logRequest,
  logResponse,
  logError
} from '../_shared/utils.ts'

serve(async (req: Request) => {
  const origin = req.headers.get('origin') || ''
  
  if (req.method === 'OPTIONS') {
    return corsPreFlight()
  }

  try {
    logRequest(req)
    
    const { user_id } = await autenticar(req)
    const url = new URL(req.url)
    const parts = url.pathname.split('/').filter(Boolean)
    const recurso = parts[1] // 'objetivos'
    
    const dbc = db(req)
    
    // GET /objetivos
    if (req.method === 'GET' && parts.length === 2) {
      const tipo = url.searchParams.get('tipo')
      const status = url.searchParams.get('status')
      
      let query = dbc.from('objetivos')
        .select('*')
        .eq('user_id', user_id)
        .order('criado_em', { ascending: false })
      
      if (tipo) {
        query = query.eq('tipo', tipo)
      }
      if (status) {
        query = query.eq('status', status)
      }
      
      const { data, error } = await query
      
      if (error) throw error
      
      return logResponse(json({ dados: data }))
    }
    
    // GET /objetivos/:id
    if (req.method === 'GET' && parts.length === 3) {
      const id = extrairId(req, 'objetivos')
      
      const { data, error } = await dbc
        .from('objetivos')
        .select(`
          *,
          objetivos_progresso (
            data_snapshot,
            valor_atingido,
            percentual
          )
        `)
        .eq('id', id)
        .eq('user_id', user_id)
        .single()
      
      if (error || !data) {
        return erro('Objetivo não encontrado', 404)
      }
      
      return logResponse(json({ dados: data }))
    }
    
    // POST /objetivos (criar)
    if (req.method === 'POST' && parts.length === 2) {
      const body = await req.json()
      
      // Validações
      if (!body.tipo || !body.nome || !body.valor_meta || !body.data_inicio || !body.data_fim) {
        return erro('Campos obrigatórios: tipo, nome, valor_meta, data_inicio, data_fim', 400)
      }
      
      if (new Date(body.data_fim) < new Date(body.data_inicio)) {
        return erro('data_fim deve ser >= data_inicio', 400)
      }
      
      if (body.valor_meta <= 0) {
        return erro('valor_meta deve ser > 0', 400)
      }
      
      const { data, error } = await dbc
        .from('objetivos')
        .insert({
          user_id,
          tipo: body.tipo,
          nome: body.nome,
          descricao: body.descricao || null,
          icone: body.icone || 'target',
          cor: body.cor || 'blue',
          valor_meta: body.valor_meta,
          data_inicio: body.data_inicio,
          data_fim: body.data_fim,
          conta_id: body.conta_id || null,
          categoria_id: body.categoria_id || null,
          frequencia: body.frequencia || null,
          contas_projeto: body.contas_projeto || [],
          ativo: true
        })
        .select()
        .single()
      
      if (error) throw error
      
      return logResponse(json({ dados: data }, 201))
    }
    
    // PUT /objetivos/:id (editar)
    if (req.method === 'PUT' && parts.length === 3) {
      const id = extrairId(req, 'objetivos')
      const body = await req.json()
      
      // Buscar objetivo atual
      const { data: objetivo, error: erroGet } = await dbc
        .from('objetivos')
        .select('*')
        .eq('id', id)
        .eq('user_id', user_id)
        .single()
      
      if (erroGet || !objetivo) {
        return erro('Objetivo não encontrado', 404)
      }
      
      // Se alterando valor_meta, registrar revisão
      let revisoes = objetivo.revisoes || []
      if (body.valor_meta && body.valor_meta !== objetivo.valor_meta) {
        revisoes.push({
          data: new Date().toISOString(),
          valor_meta_anterior: objetivo.valor_meta,
          motivo: body.motivo_revisao || 'Revisão de meta'
        })
      }
      
      const { data, error } = await dbc
        .from('objetivos')
        .update({
          nome: body.nome ?? objetivo.nome,
          descricao: body.descricao ?? objetivo.descricao,
          icone: body.icone ?? objetivo.icone,
          cor: body.cor ?? objetivo.cor,
          valor_meta: body.valor_meta ?? objetivo.valor_meta,
          data_fim: body.data_fim ?? objetivo.data_fim,
          categoria_id: body.categoria_id ?? objetivo.categoria_id,
          contas_projeto: body.contas_projeto ?? objetivo.contas_projeto,
          revisoes: revisoes,
          ativo: body.ativo ?? objetivo.ativo
        })
        .eq('id', id)
        .select()
        .single()
      
      if (error) throw error
      
      return logResponse(json({ dados: data }))
    }
    
    // DELETE /objetivos/:id (cancelar)
    if (req.method === 'DELETE' && parts.length === 3) {
      const id = extrairId(req, 'objetivos')
      
      const { error } = await dbc
        .from('objetivos')
        .update({ ativo: false, status: 'CANCELADO' })
        .eq('id', id)
        .eq('user_id', user_id)
      
      if (error) throw error
      
      return logResponse(json({ dados: { id, cancelado: true } }))
    }
    
    // POST /objetivos/sincronizar-progresso (sync manual)
    if (req.method === 'POST' && parts.length === 3 && parts[2] === 'sincronizar-progresso') {
      const { data, error } = await dbc.rpc(
        'fn_sincronizar_progresso_objetivo',
        { p_user_id: user_id }
      )
      
      if (error) throw error
      
      return logResponse(json({ dados: { sincronizados: data[0]?.objetivos_atualizados || 0 } }))
    }
    
    return erro('Rota não encontrada', 404)
    
  } catch (err) {
    logError(err)
    return erro(err.message, 500)
  }
})
```

### Passo 1.3: Testes Iniciais

**Arquivo:** `tests/11_objetivos.test.ts` (primeiras 6 cases)

```ts
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import { supabaseAdmin, supabaseUser1 } from './setup'

describe('CA-OBJ: Módulo Objetivos', () => {
  let objetivo_sonho: any
  
  // CA-OBJ01: Criar sonho com dados válidos
  test('CA-OBJ01: Criar sonho com dados válidos', async () => {
    const { data, error } = await supabaseUser1
      .functions.invoke('objetivos', {
        method: 'POST',
        body: {
          tipo: 'SONHO',
          nome: 'Fundo de Emergência',
          valor_meta: 50000,
          data_inicio: '2026-06-02',
          data_fim: '2026-12-31',
          conta_id: '<CONTA_ID>', // substituir
          icone: 'shield',
          cor: 'green'
        }
      })
    
    expect(error).toBeNull()
    expect(data.dados).toBeDefined()
    expect(data.dados.tipo).toBe('SONHO')
    expect(data.dados.status).toBe('EM_PROGRESSO')
    
    objetivo_sonho = data.dados
  })
  
  // CA-OBJ02: Validar período (data_fim >= data_inicio)
  test('CA-OBJ02: Rejeitar data_fim < data_inicio', async () => {
    const { data, error } = await supabaseUser1
      .functions.invoke('objetivos', {
        method: 'POST',
        body: {
          tipo: 'SONHO',
          nome: 'Sonho inválido',
          valor_meta: 10000,
          data_inicio: '2026-12-31',
          data_fim: '2026-06-02' // Inválido
        }
      })
    
    expect(error).toBeDefined()
  })
  
  // ... outros testes
})
```

---

## Fase 2: Frontend — Tipos, Hooks e Componentes

### Passo 2.1: Adicionar Tipos TypeScript

**Arquivo:** `FrontEnd/src/types/index.ts` (adicionar ao final)

```ts
export enum TipoObjetivo {
  SONHO = 'SONHO',
  OBJETIVO = 'OBJETIVO',
  PROJETO = 'PROJETO'
}

export enum StatusObjetivo {
  EM_PROGRESSO = 'EM_PROGRESSO',
  ATINGIDO = 'ATINGIDO',
  CANCELADO = 'CANCELADO'
}

export interface Revisao {
  data: string
  valor_meta_anterior: number
  motivo: string
}

export interface Objetivo {
  id: string
  user_id: string
  tipo: TipoObjetivo
  nome: string
  descricao?: string
  icone?: string
  cor?: string
  ativo: boolean
  valor_meta: number
  data_inicio: string
  data_fim: string
  conta_id?: string
  categoria_id?: string
  frequencia?: Frequencia
  contas_projeto?: string[]
  valor_atingido: number
  percentual: number
  status: StatusObjetivo
  dias_restantes?: number
  revisoes: Revisao[]
  criado_em: string
  atualizado_em: string
}

export interface SnapshotProgresso {
  data: string
  valor: number
  percentual: number
}
```

### Passo 2.2: Criar Hook `useObjetivos`

**Arquivo:** `FrontEnd/src/hooks/useObjetivos.ts`

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '@/lib/api'
import { Objetivo, TipoObjetivo, StatusObjetivo } from '@/types'

export interface FiltroObjetivos {
  tipo?: TipoObjetivo
  status?: StatusObjetivo
}

export function useObjetivos(filtro?: FiltroObjetivos) {
  const qc = useQueryClient()
  const queryKey = ['objetivos', filtro]

  const {
    data: objetivos = [],
    isLoading,
    error
  } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filtro?.tipo) params.append('tipo', filtro.tipo)
      if (filtro?.status) params.append('status', filtro.status)
      
      const result = await apiFetch<Objetivo[]>(`/objetivos?${params.toString()}`)
      return result.ok ? result.dados || [] : []
    },
    staleTime: 30_000
  })

  const criar = useMutation({
    mutationFn: (data: Partial<Objetivo>) =>
      apiMutate<Objetivo>('/objetivos', 'POST', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
    }
  })

  const editar = useMutation({
    mutationFn: ({ id, ...data }: Partial<Objetivo> & { id: string }) =>
      apiMutate<Objetivo>(`/objetivos/${id}`, 'PUT', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
    }
  })

  const cancelar = useMutation({
    mutationFn: (id: string) =>
      apiMutate(`/objetivos/${id}`, 'DELETE'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
    }
  })

  return {
    objetivos,
    isLoading,
    error: error?.message,
    criar,
    editar,
    cancelar
  }
}

export function useObjetivoDetalhe(id: string) {
  return useQuery({
    queryKey: ['objetivo', id],
    queryFn: () => apiFetch<Objetivo>(`/objetivos/${id}`),
    select: (result) => result.ok ? result.dados : null,
    staleTime: 30_000
  })
}
```

### Passo 2.3: Criar Componente `CardObjetivo`

**Arquivo:** `FrontEnd/src/components/ui/CardObjetivo.tsx`

```tsx
import React from 'react'
import { Objetivo, TipoObjetivo } from '@/types'
import { ChevronRight } from 'lucide-react'

export interface CardObjetivoProps {
  objetivo: Objetivo
  onClique?: () => void
  onEditar?: () => void
}

export function CardObjetivo({ objetivo, onClique, onEditar }: CardObjetivoProps) {
  const iconMap: Record<string, string> = {
    'target': '🎯',
    'shield': '🛡️',
    'rocket': '🚀',
    'briefcase': '💼',
    'home': '🏠',
    'hammer': '🔨',
    'coins': '🪙',
    'trending-up': '📈'
  }
  
  const icon = iconMap[objetivo.icone || 'target'] || '🎯'
  
  const tipoLabel: Record<TipoObjetivo, string> = {
    SONHO: 'Sonho',
    OBJETIVO: 'Objetivo',
    PROJETO: 'Projeto'
  }
  
  const statusColor: Record<string, string> = {
    EM_PROGRESSO: 'bg-blue-50',
    ATINGIDO: 'bg-green-50',
    CANCELADO: 'bg-gray-50'
  }
  
  const progressColor: Record<string, string> = {
    EM_PROGRESSO: 'bg-blue-500',
    ATINGIDO: 'bg-green-500',
    CANCELADO: 'bg-gray-500'
  }

  return (
    <div
      className={`p-4 rounded-lg border border-gray-200 cursor-pointer transition-all hover:shadow-md ${statusColor[objetivo.status]}`}
      onClick={onClique}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{icon}</span>
          <div>
            <h3 className="font-semibold text-gray-900">{objetivo.nome}</h3>
            <p className="text-sm text-gray-500">
              {tipoLabel[objetivo.tipo]} • {objetivo.dias_restantes} dias
            </p>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEditar?.()
          }}
          className="text-gray-400 hover:text-gray-600"
        >
          ✏️
        </button>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="font-medium">{objetivo.percentual}%</span>
          <span className="text-gray-500">
            {objetivo.valor_atingido.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL'
            })}{' '}
            /{' '}
            {objetivo.valor_meta.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL'
            })}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${progressColor[objetivo.status]}`}
            style={{ width: `${Math.min(objetivo.percentual, 100)}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Até {new Date(objetivo.data_fim).toLocaleDateString('pt-BR')}</span>
        <ChevronRight size={16} />
      </div>
    </div>
  )
}
```

---

## Fase 3: Página Listagem e Dashboard

### Passo 3.1: Criar Página `ObjetivosPage`

**Arquivo:** `FrontEnd/src/pages/ObjetivosPage.tsx`

```tsx
import React, { useState } from 'react'
import { useObjetivos } from '@/hooks/useObjetivos'
import { CardObjetivo } from '@/components/ui/CardObjetivo'
import { TipoObjetivo } from '@/types'

export function ObjetivosPage() {
  const [tipoSelecionado, setTipoSelecionado] = useState<TipoObjetivo | undefined>()
  const { objetivos, isLoading } = useObjetivos({ tipo: tipoSelecionado })

  const objetivosPorTipo = {
    SONHO: objetivos.filter(o => o.tipo === 'SONHO'),
    OBJETIVO: objetivos.filter(o => o.tipo === 'OBJETIVO'),
    PROJETO: objetivos.filter(o => o.tipo === 'PROJETO')
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Meus Objetivos</h1>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + Novo Objetivo
        </button>
      </div>

      {/* Filtro */}
      <div className="mb-6 flex gap-2">
        {['SONHO', 'OBJETIVO', 'PROJETO'].map((tipo) => (
          <button
            key={tipo}
            onClick={() => setTipoSelecionado(tipoSelecionado === tipo ? undefined : (tipo as TipoObjetivo))}
            className={`px-4 py-2 rounded-lg transition-all ${
              tipoSelecionado === tipo
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
            }`}
          >
            {tipo}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div>Carregando...</div>
      ) : (
        <>
          {/* Sonhos */}
          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">
              💭 Sonhos ({objetivosPorTipo.SONHO.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {objetivosPorTipo.SONHO.map(obj => (
                <CardObjetivo key={obj.id} objetivo={obj} />
              ))}
            </div>
          </section>

          {/* Objetivos */}
          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">
              🎯 Objetivos ({objetivosPorTipo.OBJETIVO.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {objetivosPorTipo.OBJETIVO.map(obj => (
                <CardObjetivo key={obj.id} objetivo={obj} />
              ))}
            </div>
          </section>

          {/* Projetos */}
          <section>
            <h2 className="text-xl font-bold mb-4">
              📦 Projetos ({objetivosPorTipo.PROJETO.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {objetivosPorTipo.PROJETO.map(obj => (
                <CardObjetivo key={obj.id} objetivo={obj} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
```

---

## Continuação das Fases

Para economizar espaço, as próximas fases devem seguir o mesmo padrão:

- **Fase 3**: Continuar com `DrawerObjetivo`, forms de criação/edição
- **Fase 4**: `GraficoProgresso` usando Chart.js, snapshots diários
- **Fase 5**: Testes E2E completos
- **Fase 6**: Integrações com IA e notificações

---

## Checklist de Implementação

- [ ] Migration criada e idempotente
- [ ] Tipos TypeScript compilam
- [ ] Edge Function `/objetivos` respondendo OK
- [ ] Hook `useObjetivos` funcional
- [ ] `CardObjetivo` renderizando
- [ ] `ObjetivosPage` carregando dados
- [ ] Testes API CA-OBJ01..06 passando
- [ ] RLS testada (CA-OBJ10, CA-OBJ11)
- [ ] Sem erros console
- [ ] Documentação atualizada

---

## Referências

- [CLAUDE.md](./CLAUDE.md) — padrões do projeto
- [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) — visão geral
- [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md) — fluxos visuais
