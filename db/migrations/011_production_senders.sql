SET LOCAL ROLE lp_owner;
-- New-token executor only. Existing QIANQI/native and local journals stay separate.
CREATE TABLE launchpad.production_senders (
 project_id uuid NOT NULL, module_id uuid NOT NULL,
 chain_id bigint NOT NULL CHECK(chain_id=4663),
 sender text NOT NULL CHECK(sender ~ '^0x[0-9a-f]{40}$'),
 policy_text text NOT NULL, policy_hash text NOT NULL CHECK(policy_hash ~ '^[0-9a-f]{64}$'),
 state_text text NOT NULL, state_hash text NOT NULL CHECK(state_hash ~ '^[0-9a-f]{64}$'),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 PRIMARY KEY(project_id,module_id), UNIQUE(chain_id,sender),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.module_instances(project_id,id)
);
ALTER TABLE launchpad.production_senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.production_senders FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.production_senders
 USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT ON launchpad.production_senders TO lp_executor;
GRANT UPDATE(state_text,state_hash,revision) ON launchpad.production_senders TO lp_executor;
