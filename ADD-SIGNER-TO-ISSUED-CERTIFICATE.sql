-- Add signer name/title to issued_certificate table
-- These fields were previously only on certificate_template.
-- Now they are set at issuance time and stored per-certificate.

ALTER TABLE issued_certificate
  ADD COLUMN IF NOT EXISTS signature_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signature_title TEXT DEFAULT NULL;

-- Backfill existing issued certificates from their template's signer info
UPDATE issued_certificate ic
SET
  signature_name = ct.signature_name,
  signature_title = ct.signature_title
FROM certificate_template ct
WHERE ic.template_id = ct.template_id
  AND ic.signature_name IS NULL
  AND (ct.signature_name IS NOT NULL OR ct.signature_title IS NOT NULL);
