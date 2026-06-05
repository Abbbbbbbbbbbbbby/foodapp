-- Users (volunteers, staff, admins)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'volunteer'
    CHECK (role IN ('admin', 'staff', 'volunteer')),
  active INTEGER NOT NULL DEFAULT 1,
  self_registered INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Families (core data collected at food line)
CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  zip_code TEXT,
  date_of_birth TEXT,
  language TEXT,
  ethnicity TEXT,
  hispanic TEXT CHECK (hispanic IN ('yes', 'no', 'declined')),
  ami_bracket TEXT CHECK (ami_bracket IN
    ('<30%', '30-50%', '50-80%', '80-120%', '>120%', 'declined')),
  num_people INTEGER,
  num_children_under_18 INTEGER,
  num_children_under_5 INTEGER,
  num_with_diabetes INTEGER,
  health_insurance TEXT CHECK (health_insurance IN ('yes', 'no', 'declined')),
  snap_benefits TEXT CHECK (snap_benefits IN ('yes', 'no', 'declined')),
  receives_texts INTEGER,
  want_text_updates INTEGER,
  id_confirmed INTEGER,
  bag_received INTEGER,
  first_visit_date TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_families_phone ON families(phone);
CREATE INDEX IF NOT EXISTS idx_families_name ON families(name COLLATE NOCASE);

-- Visit log (one row per family per pickup event)
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  family_id TEXT NOT NULL REFERENCES families(id),
  visit_date TEXT NOT NULL,
  picked_up_by_phone TEXT,
  volunteer_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_visits_family_id ON visits(family_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);

-- Proxy authorizations
CREATE TABLE IF NOT EXISTS proxies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  family_id TEXT NOT NULL REFERENCES families(id),
  proxy_name TEXT,
  proxy_phone TEXT,
  proxy_form_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_proxies_phone ON proxies(proxy_phone);
CREATE INDEX IF NOT EXISTS idx_proxies_family_id ON proxies(family_id);

-- AMI income brackets (reference data for analytics)
CREATE TABLE IF NOT EXISTS income_buckets (
  id TEXT PRIMARY KEY,
  range_text TEXT NOT NULL,
  graph_label TEXT NOT NULL,
  ami_pct_min REAL NOT NULL,
  ami_pct_max REAL NOT NULL,
  families_count INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO income_buckets VALUES
  ('1', 'Less than 30% AMI', '<30%',   0.00, 0.30, 0),
  ('2', '30 to 50% AMI',     '30-50%', 0.30, 0.50, 0),
  ('3', '50 to 80% AMI',     '50-80%', 0.50, 0.80, 0),
  ('4', '80 to 120% AMI',    '80-120%',0.80, 1.20, 0),
  ('5', 'More than 120% AMI','>120%',  1.20, 9999, 0);

-- OTP codes for SMS auth (used in Plan 2, schema defined here)
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);
