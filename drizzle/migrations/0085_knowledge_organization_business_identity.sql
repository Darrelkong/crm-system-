-- Knowledge paste organizer: persist CRM-aligned business identity per AI run.
ALTER TABLE knowledge_ai_organization_runs
  ADD COLUMN business_identity_json TEXT;
