-- E-mail de entrada (v8.0.0): ao aprovar/bloquear o remetente, a rota descarta o trecho do corpo
-- (`trecho = NULL`), então o dono precisa poder atualizar essa coluna (antes só visto_em e status).
-- Continua sem poder alterar remetente, assunto, classificação etc.: só o que a tela usa.
GRANT UPDATE (visto_em, status, trecho) ON arqvalor.inv_email_mensagens TO authenticated;
