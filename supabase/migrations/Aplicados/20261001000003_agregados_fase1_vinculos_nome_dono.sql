-- ============================================================
-- "Usuários agregados" — Fase 1: fn_meus_vinculos_como_agregado precisa
-- devolver o NOME do dono, não só o dono_id.
--
-- Motivação: o seletor de espaço no frontend mostra "Conta de <nome>" —
-- sem isso, a tela só tem o UUID do dono pra exibir. O agregado não tem
-- permissão (nem deveria ter, via RLS) de ler a linha inteira de
-- `usuarios` do dono só pra pegar o nome; a função SECURITY DEFINER já
-- resolve isso com segurança (mesmo padrão de fn_aceitar_convite_agregado,
-- que já lê usuarios.email internamente) — devolve só o nome, nunca o
-- resto da linha (email, preferências, etc.).
--
-- Troca de tipo de retorno (SETOF agregados → TABLE com dono_nome) exige
-- DROP FUNCTION antes do CREATE — CREATE OR REPLACE não permite mudar o
-- tipo de retorno.
-- ============================================================

DROP FUNCTION IF EXISTS arqvalor.fn_meus_vinculos_como_agregado();

CREATE FUNCTION arqvalor.fn_meus_vinculos_como_agregado()
RETURNS TABLE (
  id              UUID,
  dono_id         UUID,
  dono_nome       TEXT,
  email_convidado TEXT,
  status          arqvalor.status_convite_agregado,
  criado_em       TIMESTAMPTZ,
  aceito_em       TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = arqvalor, pg_catalog
AS $$
  SELECT ag.id, ag.dono_id, u.nome, ag.email_convidado, ag.status, ag.criado_em, ag.aceito_em
  FROM arqvalor.agregados ag
  JOIN arqvalor.usuarios u ON u.id = ag.dono_id
  WHERE ag.agregado_id = auth.uid()
     OR (
       ag.status = 'PENDENTE'
       AND lower(ag.email_convidado) = lower((SELECT email FROM arqvalor.usuarios WHERE id = auth.uid()))
     );
$$;

REVOKE ALL ON FUNCTION arqvalor.fn_meus_vinculos_como_agregado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arqvalor.fn_meus_vinculos_como_agregado() TO authenticated;
