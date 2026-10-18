-- Preparation journals only. No signing privileges or production acceptance.
SET LOCAL ROLE lp_owner;
CREATE TABLE launchpad.holder_preparations (
 project_id uuid NOT NULL REFERENCES launchpad.projects(id),
 scope_id text NOT NULL,
 revision integer NOT NULL CHECK (revision >= 0),
 body jsonb NOT NULL,
 body_hash text NOT NULL,
 PRIMARY KEY(project_id,scope_id)
);
ALTER TABLE launchpad.holder_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.holder_preparations FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.holder_preparations
 USING (project_id=launchpad.current_project()) WITH CHECK (project_id=launchpad.current_project());
GRANT SELECT ON launchpad.holder_preparations TO lp_api;
GRANT SELECT,INSERT,UPDATE ON launchpad.holder_preparations TO lp_jobs;
RESET ROLE;
