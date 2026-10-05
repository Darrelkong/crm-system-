-- M2A additive domain only. No seed, activation, backfill or runtime cutover.
CREATE TABLE mail_corporate_signature_template_versions (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL DEFAULT 'echfront' CHECK (scope = 'echfront'),
  version_number INTEGER NOT NULL CHECK (typeof(version_number) = 'integer' AND version_number >= 1),
  rendering_contract_version TEXT NOT NULL CHECK (rendering_contract_version = 'echfront-corporate-v1'),
  brand_label TEXT NOT NULL,
  service_line_1 TEXT NOT NULL,
  service_line_2 TEXT NOT NULL,
  website TEXT NOT NULL CHECK (website = 'echfronthk.com'),
  tagline TEXT NOT NULL,
  confidentiality_heading TEXT NOT NULL,
  confidentiality_paragraph_1 TEXT NOT NULL,
  confidentiality_paragraph_2 TEXT NOT NULL,
  legal_entity_line TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  retired_at TEXT,
  retired_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK (is_active = 0 OR (activated_at IS NOT NULL AND retired_at IS NULL))
);
CREATE UNIQUE INDEX uq_mail_corporate_signature_template_version
  ON mail_corporate_signature_template_versions(scope, version_number);
CREATE UNIQUE INDEX uq_mail_corporate_signature_template_active
  ON mail_corporate_signature_template_versions(scope) WHERE is_active = 1;

-- REPLACE conflict resolution can delete rows without firing DELETE triggers
-- when recursive_triggers is OFF. Reject collisions BEFORE conflict resolution,
-- independently of PRAGMAs and of the statement's INSERT conflict policy.
CREATE TRIGGER mail_corporate_signature_template_no_replacement
BEFORE INSERT ON mail_corporate_signature_template_versions
WHEN EXISTS (
  SELECT 1 FROM mail_corporate_signature_template_versions
  WHERE id = NEW.id
    OR (scope = NEW.scope AND version_number = NEW.version_number)
    OR (NEW.is_active = 1 AND scope = NEW.scope AND is_active = 1)
)
BEGIN
  SELECT RAISE(ABORT, 'Corporate signature template replacement is forbidden');
END;
-- Lifecycle updates must also not evict another active version via UPDATE OR
-- REPLACE. Deactivate the previous active row before activating the next one.
CREATE TRIGGER mail_corporate_signature_template_no_active_replacement
BEFORE UPDATE OF is_active ON mail_corporate_signature_template_versions
WHEN NEW.is_active = 1 AND EXISTS (
  SELECT 1 FROM mail_corporate_signature_template_versions
  WHERE scope = NEW.scope AND is_active = 1 AND id != OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'Corporate signature active template replacement is forbidden');
END;

-- Content and version identity are append-only; lifecycle/attribution remain mutable.
CREATE TRIGGER mail_corporate_signature_template_content_immutable
BEFORE UPDATE OF id, scope, version_number, rendering_contract_version,
  brand_label, service_line_1, service_line_2, website, tagline,
  confidentiality_heading, confidentiality_paragraph_1, confidentiality_paragraph_2,
  legal_entity_line, created_at ON mail_corporate_signature_template_versions
BEGIN
  SELECT RAISE(ABORT, 'Corporate signature template content is immutable');
END;
CREATE TRIGGER mail_corporate_signature_template_no_delete
BEFORE DELETE ON mail_corporate_signature_template_versions
BEGIN
  SELECT RAISE(ABORT, 'Corporate signature template history must be retained');
END;

ALTER TABLE mail_sender_identities ADD COLUMN signature_identity_type TEXT
  CHECK (signature_identity_type IS NULL OR signature_identity_type IN ('personal', 'corporate'));
ALTER TABLE mail_sender_identities ADD COLUMN signature_job_title TEXT;
ALTER TABLE mail_sender_identities ADD COLUMN signature_phone TEXT;
ALTER TABLE mail_sender_identities ADD COLUMN signature_profile_revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(signature_profile_revision) = 'integer' AND signature_profile_revision >= 0);
-- Revision cannot move backwards. Future M2B writes must atomically increment it
-- on every signature-relevant edit (including address/display_name), with CAS.
CREATE TRIGGER mail_signature_profile_revision_monotonic
BEFORE UPDATE OF signature_profile_revision ON mail_sender_identities
WHEN NEW.signature_profile_revision < OLD.signature_profile_revision
BEGIN
  SELECT RAISE(ABORT, 'Signature profile revision cannot decrease');
END;

ALTER TABLE mail_signature_snapshots ADD COLUMN source_corporate_template_version_id TEXT
  REFERENCES mail_corporate_signature_template_versions(id)
  CHECK (source_corporate_template_version_id IS NULL OR source_signature_version_id IS NULL);
ALTER TABLE mail_signature_snapshots ADD COLUMN source_signature_profile_revision INTEGER
  CHECK (
    (source_corporate_template_version_id IS NULL AND source_signature_profile_revision IS NULL)
    OR (source_corporate_template_version_id IS NOT NULL
      AND source_signature_version_id IS NULL
      AND source_signature_profile_revision IS NOT NULL
      AND typeof(source_signature_profile_revision) = 'integer'
      AND source_signature_profile_revision >= 1)
  );
