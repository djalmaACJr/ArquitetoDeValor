-- ============================================================
-- Seed de novo usuário — investimentos de exemplo
--
-- Espelha o que 20260716000001_seed_lancamentos_exemplo.sql fez para
-- Extrato/Dashboard: sem isto, um usuário novo abre "Investimentos" numa
-- tela vazia (estado "Sua carteira está vazia") até cadastrar o 1º ativo.
-- Com o seed, o Painel já mostra composição, evolução do patrimônio e
-- destaques da carteira reais desde o primeiro acesso.
--
-- Trigger PRÓPRIO (não mexe em fn_sincronizar_usuario nem em
-- fn_seed_tipos_dividendo) — mesmo padrão de isolamento já usado por
-- trg_seed_tipos_dividendo, evitando reabrir funções já hardened.
--
-- Nome do trigger começa com "z_": Postgres dispara múltiplos triggers do
-- mesmo evento em ordem ALFABÉTICA do nome. "trg_seed_investimentos_exemplo"
-- (sem o "z_") ordenaria ANTES de "trg_sincronizar_usuario" — que é quem cria
-- a linha em arqvalor.usuarios — e o INSERT em arqvalor.contas aqui dentro
-- falharia com FK violation (contas.user_id → usuarios.id, não auth.users.id
-- diretamente). "z_" garante execução por último, depois que usuarios+contas
-- base já existem. Erro real reproduzido e corrigido antes de aplicar.
--
-- Decisões:
--   • Uma conta de investimento própria ("XP Investimentos") — os ativos de
--     exemplo não competem com Carteira/Nubank/Inter/C6 do seed de Extrato.
--   • 2 ativos (1 Ação + 1 FII): dá pro donut "Ativos na Carteira" mostrar
--     mais de uma fatia e pros "Destaques da carteira" terem o que rankear.
--   • Posição = 1 operação de COMPRA (mesma convenção de "posição é a soma
--     das operações" usada pelo resto do módulo — nada de posição órfã).
--   • Histórico mensal de 2 meses (anterior + atual), com leve valorização,
--     para o gráfico "Evolução do Patrimônio" já nascer com dado real (o
--     gráfico pede pelo menos 2 meses; sem isto ficaria em estado vazio).
--   • Sem inv_dividendos: exigiria mapear tipo→categoria só pra um exemplo
--     decorativo — os 4 tipos de dividendo já vêm seedados por
--     trg_seed_tipos_dividendo; o usuário lança o 1º provento quando quiser.
--   • fn_excluir_dados_usuario já apaga inv_historico_mensal/inv_posicoes/
--     inv_operacoes/inv_ativos e a própria conta por user_id — não precisa
--     de nenhum ajuste para limpar este seed.
--
-- Idempotente: CREATE OR REPLACE + trigger recriado via DROP/CREATE.
-- ============================================================

CREATE OR REPLACE FUNCTION arqvalor.fn_seed_investimentos_exemplo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
DECLARE
    v_conta_inv UUID;
    v_itsa4     UUID;
    v_mxrf11    UUID;
    v_pos_itsa4 UUID;
    v_pos_mxrf11 UUID;

    v_mes_ant    DATE := (date_trunc('month', CURRENT_DATE) - interval '1 month')::date;
    v_mes_atual  DATE := date_trunc('month', CURRENT_DATE)::date;
    v_mes_ant_txt   CHAR(7) := to_char(v_mes_ant, 'YYYY-MM');
    v_mes_atual_txt CHAR(7) := to_char(v_mes_atual, 'YYYY-MM');
BEGIN
    -- Conta de investimento própria para os ativos de exemplo.
    INSERT INTO arqvalor.contas (user_id, nome, tipo, saldo_inicial, icone, cor)
    VALUES (NEW.id, 'XP Investimentos', 'INVESTIMENTO', 0, 'https://logo.clearbit.com/xpi.com.br', '#1a1a1a')
    RETURNING id INTO v_conta_inv;

    -- ── Ativos ───────────────────────────────────────────────
    INSERT INTO arqvalor.inv_ativos (user_id, ticker, nome, tipo_ativo, moeda)
    VALUES (NEW.id, 'ITSA4', 'Itaúsa (exemplo)', 'ACOES', 'BRL')
    RETURNING id INTO v_itsa4;

    INSERT INTO arqvalor.inv_ativos (user_id, ticker, nome, tipo_ativo, moeda)
    VALUES (NEW.id, 'MXRF11', 'Maxi Renda FII (exemplo)', 'FII', 'BRL')
    RETURNING id INTO v_mxrf11;

    -- ── Posições (lote único, aberto no mês anterior) ───────────
    INSERT INTO arqvalor.inv_posicoes (user_id, ativo_id, conta_id, quantidade, preco_custo, data_compra, status)
    VALUES (NEW.id, v_itsa4, v_conta_inv, 100, 9.50, v_mes_ant + 10, 'ATIVA')
    RETURNING id INTO v_pos_itsa4;

    INSERT INTO arqvalor.inv_posicoes (user_id, ativo_id, conta_id, quantidade, preco_custo, data_compra, status)
    VALUES (NEW.id, v_mxrf11, v_conta_inv, 80, 10.20, v_mes_ant + 10, 'ATIVA')
    RETURNING id INTO v_pos_mxrf11;

    -- ── Operações (a posição É a soma das operações) ────────────
    INSERT INTO arqvalor.inv_operacoes (user_id, posicao_id, tipo_operacao, conta_id, quantidade, preco_unitario, valor_total, data_operacao)
    VALUES
        (NEW.id, v_pos_itsa4,  'COMPRA', v_conta_inv, 100, 9.50,  950.00, v_mes_ant + 10),
        (NEW.id, v_pos_mxrf11, 'COMPRA', v_conta_inv, 80,  10.20, 816.00, v_mes_ant + 10);

    -- ── Histórico mensal (2 meses — alimenta o gráfico de evolução) ──
    INSERT INTO arqvalor.inv_historico_mensal
        (user_id, ativo_id, conta_id, mes_ano, valor_mercado, quantidade, preco_medio, variacao_percentual, rentabilidade_mes)
    VALUES
        (NEW.id, v_itsa4,  v_conta_inv, v_mes_ant_txt,   970.00, 100, 9.50,  0.00, 20.00),
        (NEW.id, v_itsa4,  v_conta_inv, v_mes_atual_txt, 1005.00, 100, 9.50, 3.61, 35.00),
        (NEW.id, v_mxrf11, v_conta_inv, v_mes_ant_txt,   828.00, 80,  10.20, 0.00, 12.00),
        (NEW.id, v_mxrf11, v_conta_inv, v_mes_atual_txt, 840.00, 80,  10.20, 1.45, 12.00);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_investimentos_exemplo ON auth.users;
DROP TRIGGER IF EXISTS trg_z_seed_investimentos_exemplo ON auth.users;
CREATE TRIGGER trg_z_seed_investimentos_exemplo
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION arqvalor.fn_seed_investimentos_exemplo();
