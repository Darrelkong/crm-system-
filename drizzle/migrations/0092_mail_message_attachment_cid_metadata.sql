-- MIME-part metadata is message-scoped. Existing rows deliberately remain NULL.
ALTER TABLE mail_message_attachments
ADD COLUMN content_id_normalized TEXT COLLATE BINARY
CHECK (
  content_id_normalized IS NULL
  OR (
    length(content_id_normalized) BETWEEN 1 AND 998
    AND content_id_normalized NOT GLOB '*[^!-~]*'
    AND instr(content_id_normalized, '<') = 0
    AND instr(content_id_normalized, '>') = 0
    AND instr(content_id_normalized, char(0)) = 0
  )
);

ALTER TABLE mail_message_attachments
ADD COLUMN content_disposition TEXT
CHECK (
  content_disposition IS NULL
  OR content_disposition IN ('inline', 'attachment')
);

CREATE INDEX idx_mail_message_attachments_message_cid
ON mail_message_attachments (
  message_id,
  content_id_normalized COLLATE BINARY
)
WHERE content_id_normalized IS NOT NULL;
