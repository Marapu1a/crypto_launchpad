SET LOCAL ROLE lp_owner;
-- Reservations precede token/project creation. No FK to projects until registration.
CREATE TABLE launchpad.owner_launches (
 project_id uuid PRIMARY KEY,
 chain_id bigint NOT NULL CHECK(chain_id=4663),
 owner_address text NOT NULL CHECK(owner_address ~ '^0x[0-9a-f]{40}$'),
 slug text NOT NULL UNIQUE,
 identity text NOT NULL CHECK(identity ~ '^[0-9a-f]{64}$'),
 state_text text NOT NULL, state_hash text NOT NULL CHECK(state_hash ~ '^[0-9a-f]{64}$'),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 completed boolean NOT NULL DEFAULT false
);
-- One incomplete nonce sequence per owner, including across browser tabs/projects.
CREATE UNIQUE INDEX owner_launch_active ON launchpad.owner_launches(chain_id,owner_address) WHERE NOT completed;
ALTER TABLE launchpad.owner_launches ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.owner_launches FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.owner_launches
 USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT ON launchpad.owner_launches TO lp_executor;
GRANT UPDATE(state_text,state_hash,revision,completed) ON launchpad.owner_launches TO lp_executor;
-- Reserve worker identities before spending deployment gas, including cross-role collisions.
CREATE TABLE launchpad.owner_launch_wallets (
 sender text PRIMARY KEY CHECK(sender ~ '^0x[0-9a-f]{40}$'),
 project_id uuid NOT NULL REFERENCES launchpad.owner_launches(project_id),
 role text NOT NULL CHECK(role IN ('executor','publisher')),
 UNIQUE(project_id,role)
);
ALTER TABLE launchpad.owner_launch_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.owner_launch_wallets FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.owner_launch_wallets
 USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT ON launchpad.owner_launch_wallets TO lp_executor;
