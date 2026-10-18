-- Isolated local execution journal. Signed bytes are not exposed to public/API roles.
SET LOCAL ROLE lp_owner;
CREATE TABLE launchpad.holder_executions (
 project_id uuid NOT NULL REFERENCES launchpad.projects(id),
 scope_id text NOT NULL,
 body jsonb NOT NULL,
 body_hash text NOT NULL,
 PRIMARY KEY(project_id,scope_id)
);
CREATE TABLE launchpad.holder_plans (
 project_id uuid NOT NULL,
 scope_id text NOT NULL,
 period integer NOT NULL CHECK(period>0),
 body jsonb NOT NULL,
 body_hash text NOT NULL,
 PRIMARY KEY(project_id,scope_id,period),
 FOREIGN KEY(project_id,scope_id) REFERENCES launchpad.holder_executions(project_id,scope_id)
);
CREATE TABLE launchpad.holder_transactions (
 project_id uuid NOT NULL,
 scope_id text NOT NULL,
 tx_hash text NOT NULL,
 chain_id bigint NOT NULL,
 sender text NOT NULL,
 nonce bigint NOT NULL CHECK(nonce>=0),
 body jsonb NOT NULL,
 body_hash text NOT NULL,
 status text NOT NULL DEFAULT 'unknown' CHECK(status IN ('unknown','succeeded','reverted')),
 observation jsonb,
 PRIMARY KEY(project_id,scope_id,tx_hash),
 UNIQUE(chain_id,sender,nonce),
 FOREIGN KEY(project_id,scope_id) REFERENCES launchpad.holder_executions(project_id,scope_id)
);
CREATE UNIQUE INDEX holder_one_unresolved ON launchpad.holder_transactions(project_id,scope_id) WHERE status='unknown';
ALTER TABLE launchpad.holder_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.holder_executions FORCE ROW LEVEL SECURITY;
ALTER TABLE launchpad.holder_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.holder_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE launchpad.holder_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.holder_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.holder_executions USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
CREATE POLICY project_scope ON launchpad.holder_plans USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
CREATE POLICY project_scope ON launchpad.holder_transactions USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT ON launchpad.holder_preparations TO lp_executor;
GRANT SELECT,INSERT ON launchpad.holder_executions,launchpad.holder_plans TO lp_executor;
GRANT SELECT,INSERT,UPDATE ON launchpad.holder_transactions TO lp_executor;
RESET ROLE;
