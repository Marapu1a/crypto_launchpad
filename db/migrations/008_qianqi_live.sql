SET LOCAL ROLE lp_owner;
CREATE TABLE launchpad.qianqi_live_heads (
 project_id uuid NOT NULL, module_id uuid NOT NULL,
 head_number bigint NOT NULL CHECK(head_number>=0), head_hash text NOT NULL CHECK(head_hash ~ '^0x[0-9a-f]{64}$'),
 previous_digest text NOT NULL CHECK(previous_digest ~ '^0x[0-9a-f]{64}$'),
 digest text NOT NULL CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 payload_text text NOT NULL CHECK(jsonb_typeof(payload_text::jsonb)='object'),
 observation_text text NOT NULL CHECK(jsonb_typeof(observation_text::jsonb)='object'),
 PRIMARY KEY(project_id,module_id,head_number),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.qianqi_imports(project_id,module_id)
);
CREATE TABLE launchpad.qianqi_live_halts (
 project_id uuid NOT NULL, module_id uuid NOT NULL, reason text NOT NULL,
 PRIMARY KEY(project_id,module_id),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.qianqi_imports(project_id,module_id)
);
ALTER TABLE launchpad.qianqi_live_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.qianqi_live_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.qianqi_live_heads USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
ALTER TABLE launchpad.qianqi_live_halts ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.qianqi_live_halts FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.qianqi_live_halts USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT ON launchpad.qianqi_live_heads,launchpad.qianqi_live_halts TO lp_jobs;
