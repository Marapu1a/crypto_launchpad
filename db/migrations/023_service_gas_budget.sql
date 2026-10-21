SET LOCAL ROLE lp_owner;
CREATE TABLE launchpad.service_gas_budgets (
 project_id uuid PRIMARY KEY REFERENCES launchpad.projects(id),
 body jsonb NOT NULL, body_hash text NOT NULL,
 last_at bigint NOT NULL DEFAULT 0 CHECK(last_at>=0),
 notice jsonb
);
CREATE TABLE launchpad.service_gas_reservations (
 project_id uuid NOT NULL REFERENCES launchpad.service_gas_budgets(project_id),
 sender text NOT NULL, nonce bigint NOT NULL CHECK(nonce>=0),
 intent jsonb NOT NULL, intent_hash text NOT NULL,
 reserved_period bigint NOT NULL CHECK(reserved_period>=0),
 maximum numeric(78,0) NOT NULL CHECK(maximum>0),
 settled_period bigint, actual numeric(78,0),
 observation jsonb, observation_hash text,
 PRIMARY KEY(project_id,sender,nonce),
 CHECK((actual IS NULL AND settled_period IS NULL AND observation IS NULL AND observation_hash IS NULL)
 OR (actual>=0 AND actual<=maximum AND settled_period>=reserved_period AND observation IS NOT NULL AND observation_hash IS NOT NULL))
);
CREATE INDEX service_gas_period ON launchpad.service_gas_reservations(project_id,settled_period);
ALTER TABLE launchpad.service_gas_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.service_gas_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE launchpad.service_gas_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.service_gas_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.service_gas_budgets USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
CREATE POLICY project_scope ON launchpad.service_gas_reservations USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT ON launchpad.service_gas_budgets TO lp_executor;
GRANT UPDATE(last_at,notice) ON launchpad.service_gas_budgets TO lp_executor;
GRANT SELECT,INSERT ON launchpad.service_gas_reservations TO lp_executor;
GRANT UPDATE(settled_period,actual,observation,observation_hash) ON launchpad.service_gas_reservations TO lp_executor;
RESET ROLE;
