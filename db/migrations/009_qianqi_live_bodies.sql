SET LOCAL ROLE lp_owner;
CREATE TABLE launchpad.qianqi_live_bodies (
 project_id uuid NOT NULL, module_id uuid NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 body_text text NOT NULL CHECK(jsonb_typeof(body_text::jsonb)='object'),
 PRIMARY KEY(project_id,module_id,digest),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.qianqi_imports(project_id,module_id)
);
ALTER TABLE launchpad.qianqi_live_bodies ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.qianqi_live_bodies FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.qianqi_live_bodies USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT ON launchpad.qianqi_live_bodies TO lp_jobs;
