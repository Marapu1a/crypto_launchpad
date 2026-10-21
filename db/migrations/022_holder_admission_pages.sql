SET LOCAL ROLE lp_owner;
CREATE TABLE launchpad.holder_admission_pages (
 project_id uuid NOT NULL,
 scope_id text NOT NULL,
 period integer NOT NULL CHECK(period>0),
 candidate_id text NOT NULL,
 attempt integer NOT NULL CHECK(attempt>0),
 body jsonb NOT NULL,
 body_hash text NOT NULL,
 PRIMARY KEY(project_id,scope_id,period,candidate_id,attempt),
 FOREIGN KEY(project_id,scope_id) REFERENCES launchpad.holder_preparations(project_id,scope_id)
);
ALTER TABLE launchpad.holder_admission_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.holder_admission_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.holder_admission_pages USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT,UPDATE ON launchpad.holder_admission_pages TO lp_jobs;
RESET ROLE;
