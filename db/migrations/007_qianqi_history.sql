SET LOCAL ROLE lp_owner;
-- Separate immutable QIANQI historical adapter: never an executor cursor.
CREATE TABLE launchpad.qianqi_imports (
 project_id uuid NOT NULL,
 module_id uuid NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 head_number bigint NOT NULL CHECK(head_number>=0),
 head_hash text NOT NULL CHECK(head_hash ~ '^0x[0-9a-f]{64}$'),
 metadata_text text NOT NULL CHECK(jsonb_typeof(metadata_text::jsonb)='object'),
 PRIMARY KEY(project_id,module_id),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.module_instances(project_id,id)
);
CREATE TABLE launchpad.qianqi_history_rows (
 project_id uuid NOT NULL,
 module_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('purchase','wallet','event','draw')),
 row_key text NOT NULL,
 value_text text NOT NULL CHECK(jsonb_typeof(value_text::jsonb)='object'),
 PRIMARY KEY(project_id,module_id,kind,row_key),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.qianqi_imports(project_id,module_id)
);
ALTER TABLE launchpad.qianqi_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.qianqi_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.qianqi_imports USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
ALTER TABLE launchpad.qianqi_history_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.qianqi_history_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.qianqi_history_rows USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT ON launchpad.qianqi_imports,launchpad.qianqi_history_rows TO lp_jobs;
