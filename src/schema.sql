-- D1 schema for storing received emails
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  received_at TEXT,
  message_id TEXT,
  sender TEXT,
  recipients TEXT,
  cc TEXT,
  bcc TEXT,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  headers TEXT,
  attachments TEXT,
  raw TEXT,
  size INTEGER,
  subdomain TEXT
);

CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender);
