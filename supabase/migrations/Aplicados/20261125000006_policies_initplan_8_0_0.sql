-- v8.0.0: avalia auth.uid() uma vez por consulta (e não por linha) nas policies criadas nesta release
-- (alerta auth_rls_initplan do advisor). Mesma regra de acesso, só o plano de execução muda.
ALTER POLICY inv_analises_assembleia_dono ON arqvalor.inv_analises_assembleia
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
ALTER POLICY inv_email_enderecos_dono ON arqvalor.inv_email_enderecos
    USING (user_id = (SELECT auth.uid()));
ALTER POLICY inv_email_enderecos_dono_upd ON arqvalor.inv_email_enderecos
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
ALTER POLICY inv_email_remetentes_dono ON arqvalor.inv_email_remetentes
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
ALTER POLICY inv_email_mensagens_dono ON arqvalor.inv_email_mensagens
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
