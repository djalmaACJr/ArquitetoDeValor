-- ============================================================
-- Fundação de "usuários agregados" (Fase 0) — compartilhamento de dados
-- entre contas (tipo "conta conjunta"). Sem NENHUMA mudança visível ainda:
-- zero policy nova nas tabelas de dados existentes (contas/transacoes/
-- objetivos/inv_*), zero Edge Function nova. Só o alicerce:
--
--   • 2 ENUMs + 3 tabelas novas (vínculo dono↔agregado, permissões por
--     módulo, contas liberadas).
--   • Função helper `fn_agregado_tem_acesso`, reusada nas Fases 1-4 pra
--     não duplicar a mesma subquery em toda policy nova.
--   • RPCs SECURITY DEFINER pro ciclo de vida completo do convite
--     (convidar/reenviar/revogar/aceitar/recusar/definir permissões e
--     contas) — mesmo padrão de `fn_excluir_dados_usuario`: nenhuma
--     policy de escrita nas tabelas novas, toda mutação centralizada e
--     auditável numa função só.
--   • Extensão de `fn_sincronizar_usuario` (resolve convite pendente
--     quando o convidado ainda não tinha conta) e de
--     `_excluir_dados_usuario_interno` (limpa vínculos ao excluir conta).
--
-- Precedente de RLS seguido (não inventado agora): policy ADICIONAL
-- permissiva, mesmo padrão de `trilha_auditoria_admin_select`
-- (20260820000001) — o Postgres já faz OR entre policies permissivas do
-- mesmo comando, então nada existente precisa ser reescrito nas fases
-- seguintes.
--
-- Idempotente: DO/EXCEPTION nos ENUMs e policies, CREATE TABLE/INDEX IF
-- NOT EXISTS, CREATE OR REPLACE nas funções.
-- ============================================================

-- ── ENUMs ──────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE arqvalor.status_convite_agregado AS ENUM ('PENDENTE','ACEITO','RECUSADO','REVOGADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE arqvalor.modulo_agregado AS ENUM ('EXTRATO','OBJETIVOS','INVESTIMENTOS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tabelas ────────────────────────────────────────────────────

-- Vínculo dono → agregado. `agregado_id` fica NULL enquanto o convite está
-- pendente para um e-mail sem cadastro; é preenchido no aceite (manual, via
-- RPC, ou automático no signup — ver fn_sincronizar_usuario abaixo).
CREATE TABLE IF NOT EXISTS arqvalor.agregados (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dono_id          UUID NOT NULL REFERENCES arqvalor.usuarios(id) ON DELETE CASCADE,
  agregado_id      UUID     REFERENCES arqvalor.usuarios(id) ON DELETE CASCADE,
  email_convidado  TEXT NOT NULL,
  status           arqvalor.status_convite_agregado NOT NULL DEFAULT 'PENDENTE',
  token            UUID NOT NULL DEFAULT gen_random_uuid(),
  token_expira_em  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  aceito_em        TIMESTAMPTZ,
  revogado_em      TIMESTAMPTZ,
  CONSTRAINT chk_agregados_nao_proprio CHECK (agregado_id IS NULL OR agregado_id <> dono_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agregados_token     ON arqvalor.agregados(token);
CREATE INDEX IF NOT EXISTS idx_agregados_dono            ON arqvalor.agregados(dono_id);
CREATE INDEX IF NOT EXISTS idx_agregados_agregado        ON arqvalor.agregados(agregado_id);
-- Não deixa existir 2 convites "vivos" (pendente ou aceito) pro mesmo par
-- dono+e-mail — pode reconvidar livremente depois de RECUSADO/REVOGADO.
CREATE UNIQUE INDEX IF NOT EXISTS ux_agregados_dono_email_ativo ON arqvalor.agregados
  (dono_id, lower(email_convidado)) WHERE status IN ('PENDENTE','ACEITO');

-- Permissão por módulo — um vínculo pode ter 0 a 3 linhas aqui (uma por
-- módulo liberado). Ausência de linha = módulo não liberado.
CREATE TABLE IF NOT EXISTS arqvalor.agregados_permissoes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agregado_vinculo_id  UUID NOT NULL REFERENCES arqvalor.agregados(id) ON DELETE CASCADE,
  modulo               arqvalor.modulo_agregado NOT NULL,
  pode_escrever        BOOLEAN NOT NULL DEFAULT false,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agregado_vinculo_id, modulo)
);

-- Contas liberadas — lista COMPARTILHADA entre Extrato e Investimentos (é a
-- mesma tabela `contas`; não há distinção de módulo aqui de propósito).
CREATE TABLE IF NOT EXISTS arqvalor.agregados_contas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agregado_vinculo_id  UUID NOT NULL REFERENCES arqvalor.agregados(id) ON DELETE CASCADE,
  conta_id             UUID NOT NULL REFERENCES arqvalor.contas(id) ON DELETE CASCADE,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agregado_vinculo_id, conta_id)
);

-- Defesa em profundidade (mesmo espírito de fn_validar_isolamento_usuario):
-- a conta liberada tem que pertencer mesmo ao dono do vínculo. A RPC
-- fn_definir_contas_agregado já valida isso antes de inserir, mas um
-- trigger de banco fecha a garantia independente de quem chame o INSERT.
CREATE OR REPLACE FUNCTION arqvalor.fn_validar_conta_agregado()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = arqvalor, pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM arqvalor.agregados ag
    JOIN arqvalor.contas c ON c.id = NEW.conta_id
    WHERE ag.id = NEW.agregado_vinculo_id AND c.user_id = ag.dono_id
  ) THEN
    RAISE EXCEPTION 'CONTA_FORA_DO_DONO: a conta não pertence ao dono deste vínculo.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validar_conta_agregado ON arqvalor.agregados_contas;
CREATE TRIGGER trg_validar_conta_agregado BEFORE INSERT ON arqvalor.agregados_contas
  FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_validar_conta_agregado();

-- ── RLS — só SELECT para authenticated; toda escrita via RPC abaixo ───
-- Mesmo raciocínio de trilha_auditoria: transições de estado do convite
-- (só o convidado com e-mail batendo aceita, só enquanto pendente e não
-- expirado, etc.) são mais seguras centralizadas numa função auditável do
-- que expressas em RLS puro.
ALTER TABLE arqvalor.agregados            ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqvalor.agregados_permissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqvalor.agregados_contas     ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY agregados_select ON arqvalor.agregados
    FOR SELECT USING (dono_id = (select auth.uid()) OR agregado_id = (select auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agregados_permissoes_select ON arqvalor.agregados_permissoes
    FOR SELECT USING (EXISTS (
      SELECT 1 FROM arqvalor.agregados ag WHERE ag.id = agregado_vinculo_id
        AND (ag.dono_id = (select auth.uid()) OR ag.agregado_id = (select auth.uid()))
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agregados_contas_select ON arqvalor.agregados_contas
    FOR SELECT USING (EXISTS (
      SELECT 1 FROM arqvalor.agregados ag WHERE ag.id = agregado_vinculo_id
        AND (ag.dono_id = (select auth.uid()) OR ag.agregado_id = (select auth.uid()))
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Função helper central (usada a partir da Fase 1) ──────────────────
-- SECURITY INVOKER funciona porque a policy de SELECT acima já deixa o
-- agregado ler a própria linha (agregado_id = auth.uid()).
CREATE OR REPLACE FUNCTION arqvalor.fn_agregado_tem_acesso(
  p_dono_id  UUID,
  p_modulo   arqvalor.modulo_agregado,
  p_conta_id UUID DEFAULT NULL,
  p_escrita  BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = arqvalor, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM arqvalor.agregados ag
    JOIN arqvalor.agregados_permissoes perm ON perm.agregado_vinculo_id = ag.id
    WHERE ag.dono_id = p_dono_id
      AND ag.agregado_id = auth.uid()
      AND ag.status = 'ACEITO'
      AND perm.modulo = p_modulo
      AND (NOT p_escrita OR perm.pode_escrever)
      AND (
        p_conta_id IS NULL
        OR EXISTS (
          SELECT 1 FROM arqvalor.agregados_contas ac
          WHERE ac.agregado_vinculo_id = ag.id AND ac.conta_id = p_conta_id
        )
      )
  );
$$;

-- ── RPCs (ciclo de vida do convite) ────────────────────────────────────
-- Todas SECURITY DEFINER + search_path fixo, autorizando SÓ via auth.uid()
-- (nunca current_user — ver comentário extenso em
-- 20260929000001_fix_bypass_fn_excluir_dados_usuario.sql sobre por que
-- isso importa).

CREATE OR REPLACE FUNCTION arqvalor.fn_convidar_agregado(p_email TEXT)
RETURNS arqvalor.agregados
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE
  v_dono_id    UUID := auth.uid();
  v_email      TEXT := lower(trim(p_email));
  v_dono_email TEXT;
  v_row        arqvalor.agregados;
BEGIN
  IF v_dono_id IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
  IF v_email IS NULL OR v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'EMAIL_INVALIDO';
  END IF;

  SELECT email INTO v_dono_email FROM arqvalor.usuarios WHERE id = v_dono_id;
  IF v_dono_email IS NOT NULL AND lower(v_dono_email) = v_email THEN
    RAISE EXCEPTION 'CONVITE_PROPRIO: não é possível convidar a própria conta.';
  END IF;

  SELECT * INTO v_row FROM arqvalor.agregados
    WHERE dono_id = v_dono_id AND lower(email_convidado) = v_email AND status IN ('PENDENTE','ACEITO');
  IF FOUND THEN
    IF v_row.status = 'ACEITO' THEN
      RAISE EXCEPTION 'JA_AGREGADO: este e-mail já é um agregado ativo.';
    END IF;
    RETURN v_row; -- já pendente — o endpoint decide se reenvia o e-mail
  END IF;

  INSERT INTO arqvalor.agregados (dono_id, email_convidado)
  VALUES (v_dono_id, v_email)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION arqvalor.fn_reenviar_convite_agregado(p_vinculo_id UUID)
RETURNS arqvalor.agregados
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE v_row arqvalor.agregados;
BEGIN
  UPDATE arqvalor.agregados
     SET token = gen_random_uuid(), token_expira_em = now() + interval '7 days', atualizado_em = now()
   WHERE id = p_vinculo_id AND dono_id = auth.uid() AND status = 'PENDENTE'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_NAO_ENCONTRADO'; END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION arqvalor.fn_revogar_agregado(p_vinculo_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
BEGIN
  UPDATE arqvalor.agregados
     SET status = 'REVOGADO', revogado_em = now(), atualizado_em = now()
   WHERE id = p_vinculo_id AND dono_id = auth.uid() AND status IN ('PENDENTE','ACEITO');
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_NAO_ENCONTRADO'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION arqvalor.fn_aceitar_convite_agregado(p_token UUID)
RETURNS arqvalor.agregados
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_row   arqvalor.agregados;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
  SELECT email INTO v_email FROM arqvalor.usuarios WHERE id = v_uid;

  SELECT * INTO v_row FROM arqvalor.agregados WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_NAO_ENCONTRADO'; END IF;
  IF v_row.status <> 'PENDENTE' THEN RAISE EXCEPTION 'CONVITE_INVALIDO: já respondido ou revogado.'; END IF;
  IF v_row.token_expira_em < now() THEN RAISE EXCEPTION 'CONVITE_EXPIRADO'; END IF;
  -- Valida contra usuarios.email (sincronizado por trg_sincronizar_usuario_update),
  -- nunca contra uma claim de JWT que pode estar em cache desatualizado.
  IF v_email IS NULL OR lower(v_row.email_convidado) <> lower(v_email) THEN
    RAISE EXCEPTION 'EMAIL_NAO_CONFERE';
  END IF;
  IF v_row.dono_id = v_uid THEN RAISE EXCEPTION 'CONVITE_PROPRIO'; END IF;

  UPDATE arqvalor.agregados
     SET agregado_id = v_uid, status = 'ACEITO', aceito_em = now(), atualizado_em = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION arqvalor.fn_recusar_convite_agregado(p_token UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_row   arqvalor.agregados;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ACESSO_NEGADO'; END IF;
  SELECT email INTO v_email FROM arqvalor.usuarios WHERE id = v_uid;

  SELECT * INTO v_row FROM arqvalor.agregados WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_NAO_ENCONTRADO'; END IF;
  IF v_row.status <> 'PENDENTE' THEN RAISE EXCEPTION 'CONVITE_INVALIDO'; END IF;
  IF v_email IS NULL OR lower(v_row.email_convidado) <> lower(v_email) THEN
    RAISE EXCEPTION 'EMAIL_NAO_CONFERE';
  END IF;

  UPDATE arqvalor.agregados SET status = 'RECUSADO', atualizado_em = now() WHERE id = v_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION arqvalor.fn_definir_permissoes_agregado(
  p_vinculo_id UUID, p_modulo arqvalor.modulo_agregado, p_liberado BOOLEAN, p_pode_escrever BOOLEAN
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM arqvalor.agregados WHERE id = p_vinculo_id AND dono_id = auth.uid()) THEN
    RAISE EXCEPTION 'VINCULO_NAO_ENCONTRADO';
  END IF;

  IF p_liberado THEN
    INSERT INTO arqvalor.agregados_permissoes (agregado_vinculo_id, modulo, pode_escrever)
    VALUES (p_vinculo_id, p_modulo, COALESCE(p_pode_escrever, false))
    ON CONFLICT (agregado_vinculo_id, modulo)
    DO UPDATE SET pode_escrever = EXCLUDED.pode_escrever, atualizado_em = now();
  ELSE
    DELETE FROM arqvalor.agregados_permissoes WHERE agregado_vinculo_id = p_vinculo_id AND modulo = p_modulo;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION arqvalor.fn_definir_contas_agregado(p_vinculo_id UUID, p_conta_ids UUID[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arqvalor, pg_catalog AS $$
DECLARE v_dono_id UUID;
BEGIN
  SELECT dono_id INTO v_dono_id FROM arqvalor.agregados WHERE id = p_vinculo_id AND dono_id = auth.uid();
  IF v_dono_id IS NULL THEN RAISE EXCEPTION 'VINCULO_NAO_ENCONTRADO'; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_conta_ids, ARRAY[]::UUID[])) cid
    WHERE NOT EXISTS (SELECT 1 FROM arqvalor.contas c WHERE c.id = cid AND c.user_id = v_dono_id)
  ) THEN
    RAISE EXCEPTION 'CONTA_INVALIDA: alguma conta informada não pertence a você.';
  END IF;

  DELETE FROM arqvalor.agregados_contas WHERE agregado_vinculo_id = p_vinculo_id;
  INSERT INTO arqvalor.agregados_contas (agregado_vinculo_id, conta_id)
  SELECT p_vinculo_id, cid FROM unnest(COALESCE(p_conta_ids, ARRAY[]::UUID[])) cid;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_convidar_agregado(TEXT)                                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION arqvalor.fn_reenviar_convite_agregado(UUID)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION arqvalor.fn_revogar_agregado(UUID)                                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION arqvalor.fn_aceitar_convite_agregado(UUID)                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION arqvalor.fn_recusar_convite_agregado(UUID)                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION arqvalor.fn_definir_permissoes_agregado(UUID, arqvalor.modulo_agregado, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION arqvalor.fn_definir_contas_agregado(UUID, UUID[])                             FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION arqvalor.fn_convidar_agregado(TEXT)                                          TO authenticated;
GRANT EXECUTE ON FUNCTION arqvalor.fn_reenviar_convite_agregado(UUID)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION arqvalor.fn_revogar_agregado(UUID)                                            TO authenticated;
GRANT EXECUTE ON FUNCTION arqvalor.fn_aceitar_convite_agregado(UUID)                                    TO authenticated;
GRANT EXECUTE ON FUNCTION arqvalor.fn_recusar_convite_agregado(UUID)                                    TO authenticated;
GRANT EXECUTE ON FUNCTION arqvalor.fn_definir_permissoes_agregado(UUID, arqvalor.modulo_agregado, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION arqvalor.fn_definir_contas_agregado(UUID, UUID[])                             TO authenticated;

-- ── fn_sincronizar_usuario: resolve convite pendente no signup ────────
-- Se o cadastro veio de um link de convite (?convite_token=... na
-- CadastroPage, repassado via supabase.auth.signUp({ options: { data:
-- { convite_agregado_token } } })), o token chega aqui via
-- NEW.raw_user_meta_data — mesmo canal já usado hoje pra 'nome'. Resolução
-- é best-effort dentro de um BEGIN/EXCEPTION próprio: token ausente,
-- malformado, expirado ou com e-mail que não bate NUNCA pode abortar o
-- cadastro inteiro — só deixa de vincular automaticamente (o convite
-- continua disponível pra aceite manual via /aceitar-convite, se ainda
-- for válido).
CREATE OR REPLACE FUNCTION arqvalor.fn_sincronizar_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $function$
DECLARE
    v_carteira   UUID;
    v_nubank     UUID;
    v_inter      UUID;

    v_cat_salario      UUID;
    v_cat_mercado      UUID;
    v_cat_restaurantes UUID;
    v_cat_combustivel  UUID;
    v_cat_farmacia     UUID;
    v_cat_aluguel      UUID;
    v_cat_academia     UUID;
    v_cat_transf       UUID;

    v_mes_atual  DATE := date_trunc('month', CURRENT_DATE)::date;
    v_mes_ant    DATE := (date_trunc('month', CURRENT_DATE) - interval '1 month')::date;
    v_par        UUID := gen_random_uuid();

    -- Lançamentos do mês corrente com dia ainda por vir ficam PENDENTE
    v_status_salario arqvalor.status_transacao;
    v_status_aluguel arqvalor.status_transacao;
BEGIN
    INSERT INTO arqvalor.usuarios (id, email, nome)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'nome', 'Convidado')
    )
    ON CONFLICT (id) DO NOTHING;

    -- ── Convite de agregado (best-effort, nunca bloqueia o cadastro) ──
    BEGIN
      UPDATE arqvalor.agregados
         SET agregado_id = NEW.id, status = 'ACEITO', aceito_em = now(), atualizado_em = now()
       WHERE token = (NEW.raw_user_meta_data->>'convite_agregado_token')::UUID
         AND status = 'PENDENTE'
         AND token_expira_em >= now()
         AND lower(email_convidado) = lower(NEW.email);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- token ausente/malformado/qualquer erro: ignora silenciosamente
    END;

    -- ── Contas iniciais (capturando os IDs usados nos exemplos) ──
    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor)
    VALUES (NEW.id, 'Carteira', 'CARTEIRA', 0, '👛', '#00c896')
    RETURNING id INTO v_carteira;

    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor)
    VALUES (NEW.id, 'Nubank', 'CARTAO', 0, 'https://logo.clearbit.com/nubank.com.br', '#820ad1')
    RETURNING id INTO v_nubank;

    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor)
    VALUES (NEW.id, 'Inter', 'CARTAO', 0, 'https://logo.clearbit.com/bancointer.com.br', '#ff7a00')
    RETURNING id INTO v_inter;

    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor)
    VALUES (NEW.id, 'C6 Bank', 'CARTAO', 0, 'https://logo.clearbit.com/c6bank.com.br', '#2d2d2d');

    -- ── Categorias (pais + subcategorias) ──
    WITH cats_pai AS (
        INSERT INTO arqvalor.categorias (user_id, descricao, icone, cor, protegida) VALUES
            (NEW.id, 'Moradia',        '🏠', '#4da6ff', FALSE),
            (NEW.id, 'Alimentação',    '🍔', '#ff7a00', FALSE),
            (NEW.id, 'Transporte',     '🚗', '#820ad1', FALSE),
            (NEW.id, 'Saúde',          '💊', '#e91e8c', FALSE),
            (NEW.id, 'Renda',          '💼', '#00c896', FALSE),
            (NEW.id, 'Transferências', '🔄', '#00b1ea', TRUE)
        RETURNING id, descricao
    )
    INSERT INTO arqvalor.categorias (user_id, id_pai, descricao, icone, cor, protegida)
    SELECT NEW.id, p.id, s.descricao, s.icone, s.cor, FALSE
    FROM cats_pai p
    JOIN (VALUES
        ('Moradia',        'Aluguel',           '🏠', '#4da6ff'),
        ('Moradia',        'Condomínio',         '🏢', '#4da6ff'),
        ('Moradia',        'IPTU',               '📄', '#4da6ff'),
        ('Moradia',        'Manutenção',         '🔧', '#4da6ff'),
        ('Alimentação',    'Mercado',            '🛒', '#ff7a00'),
        ('Alimentação',    'Restaurantes',       '🍽️', '#ff7a00'),
        ('Alimentação',    'Delivery',           '🛵', '#ff7a00'),
        ('Alimentação',    'Padaria',            '🥐', '#ff7a00'),
        ('Transporte',     'Combustível',        '⛽', '#820ad1'),
        ('Transporte',     'Uber/Táxi',          '🚕', '#820ad1'),
        ('Transporte',     'Transp. Público',    '🚌', '#820ad1'),
        ('Transporte',     'Manut. Veículo',     '🔧', '#820ad1'),
        ('Saúde',          'Plano de Saúde',     '🏥', '#e91e8c'),
        ('Saúde',          'Farmácia',           '💊', '#e91e8c'),
        ('Saúde',          'Consultas',          '👨‍⚕️', '#e91e8c'),
        ('Saúde',          'Academia',           '🏋️', '#e91e8c'),
        ('Renda',          'Salário',            '💰', '#00c896'),
        ('Renda',          'Freelance',          '💻', '#00c896'),
        ('Renda',          'Aluguel Recebido',   '🏠', '#00c896'),
        ('Renda',          'Dividendos',         '📈', '#00c896')
    ) AS s(pai_nome, descricao, icone, cor)
    ON p.descricao = s.pai_nome;

    -- ── IDs das categorias usadas nos lançamentos de exemplo ──
    SELECT id INTO v_cat_salario      FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Salário';
    SELECT id INTO v_cat_mercado      FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Mercado';
    SELECT id INTO v_cat_restaurantes FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Restaurantes';
    SELECT id INTO v_cat_combustivel  FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Combustível';
    SELECT id INTO v_cat_farmacia     FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Farmácia';
    SELECT id INTO v_cat_aluguel      FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Aluguel';
    SELECT id INTO v_cat_academia     FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Academia';
    SELECT id INTO v_cat_transf       FROM arqvalor.categorias WHERE user_id = NEW.id AND descricao = 'Transferências' AND id_pai IS NULL;

    v_status_salario := CASE WHEN v_mes_atual + 4 <= CURRENT_DATE THEN 'PAGO' ELSE 'PENDENTE' END;
    v_status_aluguel := CASE WHEN v_mes_atual + 9 <= CURRENT_DATE THEN 'PAGO' ELSE 'PENDENTE' END;

    -- ── Transações de exemplo (mês anterior + mês atual) ──
    INSERT INTO arqvalor.transacoes (user_id, conta_id, categoria_id, data, descricao, valor, tipo, status) VALUES
        -- Mês anterior
        (NEW.id, v_carteira, v_cat_salario,      v_mes_ant + 4,      'Salário (exemplo)',              4850.00, 'RECEITA', 'PAGO'),
        (NEW.id, v_carteira, v_cat_aluguel,      v_mes_ant + 9,      'Aluguel (exemplo)',              1500.00, 'DESPESA', 'PAGO'),
        (NEW.id, v_inter,    v_cat_academia,     v_mes_ant + 9,      'Academia (exemplo)',              119.90, 'DESPESA', 'PAGO'),
        (NEW.id, v_nubank,   v_cat_farmacia,     v_mes_ant + 14,     'Farmácia (exemplo)',               84.30, 'DESPESA', 'PAGO'),
        -- Mês atual
        (NEW.id, v_carteira, v_cat_salario,      v_mes_atual + 4,    'Salário (exemplo)',              4850.00, 'RECEITA', v_status_salario),
        (NEW.id, v_carteira, v_cat_aluguel,      v_mes_atual + 9,    'Aluguel (exemplo)',              1500.00, 'DESPESA', v_status_aluguel),
        (NEW.id, v_nubank,   v_cat_mercado,      CURRENT_DATE - 3,   'Mercado da semana (exemplo)',     287.90, 'DESPESA', 'PAGO'),
        (NEW.id, v_nubank,   v_cat_restaurantes, CURRENT_DATE - 5,   'Almoço restaurante (exemplo)',     68.50, 'DESPESA', 'PAGO'),
        (NEW.id, v_inter,    v_cat_combustivel,  CURRENT_DATE - 6,   'Combustível (exemplo)',           190.00, 'DESPESA', 'PAGO');

    -- ── Transferência de exemplo (par débito + crédito) ──
    -- Pagamento de fatura: sai da Carteira, entra no cartão Nubank.
    INSERT INTO arqvalor.transacoes
        (user_id, conta_id, categoria_id, data, descricao, valor, tipo, status, id_par_transferencia) VALUES
        (NEW.id, v_carteira, v_cat_transf, CURRENT_DATE - 1,
         '[Transf. saída] Pagamento fatura Nubank (exemplo)', 250.00, 'DESPESA', 'PAGO', v_par),
        (NEW.id, v_nubank,   v_cat_transf, CURRENT_DATE - 1,
         '[Transf. entrada] Pagamento fatura Nubank (exemplo)', 250.00, 'RECEITA', 'PAGO', v_par);

    RETURN NEW;
END;
$function$;

-- ── _excluir_dados_usuario_interno: limpa vínculos de agregado ────────
-- Mesmo corpo de 20260929000002 (versão vigente), só acrescentando a
-- limpeza de `agregados` (cascade cuida de agregados_permissoes/
-- agregados_contas). Sem trigger de trilha_auditoria nessas 3 tabelas
-- (ver nota abaixo), então não precisa de DISABLE/ENABLE TRIGGER extra.
--
-- NOTA: de propósito, esta rodada NÃO liga `trg_trilha_auditoria` em
-- `agregados`/`agregados_permissoes`/`agregados_contas` — o trigger
-- genérico (`fn_registrar_trilha_auditoria`) assume uma coluna `user_id`,
-- que estas tabelas não têm (têm `dono_id`/`agregado_id`). Adaptar o
-- trigger genérico ou escrever um dedicado fica pra Fase 5 (hardening),
-- pra não arriscar o trigger compartilhado nesta fase fundacional.
CREATE OR REPLACE FUNCTION arqvalor._excluir_dados_usuario_interno(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
BEGIN
  ALTER TABLE arqvalor.categorias DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.transacoes DISABLE TRIGGER USER;
  ALTER TABLE arqvalor.contas     DISABLE TRIGGER USER;

  DELETE FROM arqvalor.trilha_auditoria WHERE user_id = p_user_id;

  -- Vínculos de agregado — como dono OU como agregado de outra conta.
  -- Dados próprios do agregado (contas/transações/etc. dele) continuam
  -- intactos: são apartados por definição, só perde o acesso ao espaço
  -- de terceiro.
  DELETE FROM arqvalor.agregados WHERE dono_id = p_user_id OR agregado_id = p_user_id;

  DELETE FROM arqvalor.fatura_import_item   WHERE user_id = p_user_id;
  DELETE FROM arqvalor.fatura_import_sessao WHERE user_id = p_user_id;

  DELETE FROM arqvalor.inv_historico_mensal WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_dividendos       WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_operacoes        WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_posicoes         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_alocacoes_tipo   WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_avaliacoes       WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_questionarios    WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_proventos_fundo  WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_tipos_dividendo  WHERE user_id = p_user_id;
  DELETE FROM arqvalor.inv_ativos           WHERE user_id = p_user_id;

  DELETE FROM arqvalor.objetivos_progresso
    WHERE objetivo_id IN (SELECT id FROM arqvalor.objetivos WHERE user_id = p_user_id);
  DELETE FROM arqvalor.objetivos            WHERE user_id = p_user_id;

  DELETE FROM arqvalor.lembretes              WHERE user_id = p_user_id;
  DELETE FROM arqvalor.filtros_salvos         WHERE user_id = p_user_id;
  DELETE FROM arqvalor.assistente_lancamentos WHERE user_id = p_user_id;

  DELETE FROM arqvalor.transacoes WHERE user_id = p_user_id;

  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id AND id_pai IS NOT NULL;
  DELETE FROM arqvalor.categorias WHERE user_id = p_user_id AND id_pai IS NULL;

  DELETE FROM arqvalor.contas     WHERE user_id = p_user_id;

  DELETE FROM arqvalor.usuarios   WHERE id = p_user_id;

  ALTER TABLE arqvalor.categorias ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.transacoes ENABLE TRIGGER USER;
  ALTER TABLE arqvalor.contas     ENABLE TRIGGER USER;
END;
$$;

REVOKE ALL ON FUNCTION arqvalor._excluir_dados_usuario_interno(UUID) FROM PUBLIC, anon, authenticated, service_role;
