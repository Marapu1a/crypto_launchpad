SET LOCAL ROLE lp_owner;
CREATE TABLE launchpad.worker_states (
 project_id uuid NOT NULL,module_id uuid NOT NULL,
 config_hash text NOT NULL CHECK(config_hash ~ '^[0-9a-f]{64}$'),
 state_text text NOT NULL,state_hash text NOT NULL CHECK(state_hash ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(project_id,module_id),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.financial_executors(project_id,module_id)
);
ALTER TABLE launchpad.worker_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.worker_states FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.worker_states USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT ON launchpad.worker_states TO lp_executor;
GRANT UPDATE(state_text,state_hash) ON launchpad.worker_states TO lp_executor;
