SET LOCAL ROLE lp_owner;
CREATE TABLE launchpad.holder_reconciliation (
 project_id uuid NOT NULL,
 scope_id text NOT NULL,
 body jsonb NOT NULL,
 body_hash text NOT NULL,
 PRIMARY KEY(project_id,scope_id),
 FOREIGN KEY(project_id,scope_id) REFERENCES launchpad.holder_executions(project_id,scope_id)
);
ALTER TABLE launchpad.holder_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.holder_reconciliation FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.holder_reconciliation USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT,UPDATE ON launchpad.holder_reconciliation TO lp_executor;
RESET ROLE;
