SET LOCAL ROLE lp_owner;
-- Bootstrap lp_ingest separately. Raw public chain evidence has no project secrets.
CREATE TABLE launchpad.chain_sources (
  id uuid PRIMARY KEY,
  chain_id bigint NOT NULL CHECK(chain_id>0),
  genesis_hash text NOT NULL CHECK(genesis_hash ~ '^0x[0-9a-f]{64}$'),
  anchor_number bigint NOT NULL CHECK(anchor_number>=0),
  anchor_hash text NOT NULL CHECK(anchor_hash ~ '^0x[0-9a-f]{64}$'),
  head_number bigint NOT NULL CHECK(head_number>=anchor_number),
  head_hash text NOT NULL CHECK(head_hash ~ '^0x[0-9a-f]{64}$'),
  halted boolean NOT NULL DEFAULT false
);
CREATE TABLE launchpad.chain_blocks (
  source_id uuid NOT NULL REFERENCES launchpad.chain_sources(id),
  number bigint NOT NULL CHECK(number>=0),
  hash text NOT NULL CHECK(hash ~ '^0x[0-9a-f]{64}$'),
  evidence jsonb NOT NULL,
  PRIMARY KEY(source_id,number), UNIQUE(source_id,number,hash)
);
CREATE TABLE launchpad.read_subscriptions (
  project_id uuid NOT NULL,
  module_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES launchpad.chain_sources(id),
  cursor_number bigint NOT NULL CHECK(cursor_number>=0),
  cursor_hash text NOT NULL CHECK(cursor_hash ~ '^0x[0-9a-f]{64}$'),
  PRIMARY KEY(project_id,module_id),
  UNIQUE(project_id,module_id,source_id),
  FOREIGN KEY(project_id,module_id) REFERENCES launchpad.module_instances(project_id,id)
);
CREATE TABLE launchpad.project_evidence (
  project_id uuid NOT NULL,
  module_id uuid NOT NULL,
  source_id uuid NOT NULL,
  number bigint NOT NULL,
  hash text NOT NULL,
  evidence jsonb NOT NULL,
  PRIMARY KEY(project_id,module_id,number),
  FOREIGN KEY(project_id,module_id,source_id) REFERENCES launchpad.read_subscriptions(project_id,module_id,source_id),
  FOREIGN KEY(source_id,number,hash) REFERENCES launchpad.chain_blocks(source_id,number,hash)
);
ALTER TABLE launchpad.read_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.read_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.read_subscriptions USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
ALTER TABLE launchpad.project_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.project_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.project_evidence USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT USAGE ON SCHEMA launchpad TO lp_ingest;
GRANT SELECT ON launchpad.chain_sources,launchpad.chain_blocks TO lp_ingest,lp_jobs;
GRANT INSERT ON launchpad.chain_blocks TO lp_ingest;
GRANT UPDATE(head_number,head_hash,halted) ON launchpad.chain_sources TO lp_ingest;
GRANT SELECT ON launchpad.read_subscriptions,launchpad.project_evidence TO lp_jobs;
GRANT UPDATE(cursor_number,cursor_hash) ON launchpad.read_subscriptions TO lp_jobs;
GRANT INSERT ON launchpad.project_evidence TO lp_jobs;
