SET LOCAL ROLE lp_owner;
-- Exact text preserves the existing profile/bundle digest's JSON key order.
CREATE TABLE launchpad.ticket_shadows (
  project_id uuid NOT NULL,
  module_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES launchpad.chain_sources(id),
  profile_text text NOT NULL CHECK(jsonb_typeof(profile_text::jsonb)='object'),
  profile_hash text NOT NULL CHECK(profile_hash ~ '^[0-9a-f]{64}$'),
  state_text text NOT NULL CHECK(jsonb_typeof(state_text::jsonb)='object'),
  state_hash text NOT NULL CHECK(state_hash ~ '^[0-9a-f]{64}$'),
  cursor_number bigint NOT NULL CHECK(cursor_number>=0),
  cursor_hash text NOT NULL CHECK(cursor_hash ~ '^0x[0-9a-f]{64}$'),
  PRIMARY KEY(project_id,module_id),
  FOREIGN KEY(project_id,module_id) REFERENCES launchpad.module_instances(project_id,id)
);
ALTER TABLE launchpad.ticket_shadows ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.ticket_shadows FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.ticket_shadows USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT ON launchpad.ticket_shadows TO lp_jobs;
GRANT UPDATE(state_text,state_hash,cursor_number,cursor_hash) ON launchpad.ticket_shadows TO lp_jobs;
