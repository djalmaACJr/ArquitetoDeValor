-- ============================================================
-- Importação de fatura: guarda o PDF original para download.
--
--  • arqvalor.fatura_import_sessao.arquivo_path — caminho do PDF no bucket
--    (NULL em sessões antigas, anteriores a esta migration).
--  • Bucket PRIVADO `faturas-pdf` (15 MB, só application/pdf). Objetos ficam
--    em `<user_id>/<sessao_id>.pdf`; as policies liberam só a pasta do próprio
--    usuário (auth.uid()). O download usa URL assinada de curta duração.
--  • PDF protegido por senha é guardado como veio (cifrado): a senha nunca é
--    persistida.
-- Idempotente.
-- ============================================================

ALTER TABLE arqvalor.fatura_import_sessao
  ADD COLUMN IF NOT EXISTS arquivo_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('faturas-pdf', 'faturas-pdf', false, 15728640, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 15728640,
      allowed_mime_types = ARRAY['application/pdf'];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'faturas_pdf_select_proprio') THEN
    CREATE POLICY faturas_pdf_select_proprio ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'faturas-pdf' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'faturas_pdf_insert_proprio') THEN
    CREATE POLICY faturas_pdf_insert_proprio ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'faturas-pdf' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'faturas_pdf_delete_proprio') THEN
    CREATE POLICY faturas_pdf_delete_proprio ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'faturas-pdf' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
  END IF;
END $$;
