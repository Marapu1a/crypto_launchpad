SET LOCAL ROLE lp_owner;
-- Reserve both roles in one namespace, including executor/publisher cross-collisions.
CREATE TABLE launchpad.production_wallets (
 chain_id bigint NOT NULL CHECK(chain_id=4663),
 sender text NOT NULL CHECK(sender ~ '^0x[0-9a-f]{40}$'),
 project_id uuid NOT NULL, module_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('executor','publisher')),
 PRIMARY KEY(chain_id,sender), UNIQUE(project_id,module_id,role),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.production_senders(project_id,module_id)
);
ALTER TABLE launchpad.production_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.production_wallets FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.production_wallets
 USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT,INSERT ON launchpad.production_wallets TO lp_executor;
CREATE FUNCTION launchpad.reserve_production_wallets() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.sender <> lower(NEW.policy_text::jsonb->>'executor') THEN
   RAISE EXCEPTION 'Executor policy mismatch';
 END IF;
 INSERT INTO launchpad.production_wallets VALUES
 (4663,NEW.sender,NEW.project_id,NEW.module_id,'executor'),
 (4663,lower(NEW.policy_text::jsonb->>'publisher'),NEW.project_id,NEW.module_id,'publisher');
 RETURN NEW;
END $$;
CREATE TRIGGER reserve_wallets AFTER INSERT ON launchpad.production_senders
 FOR EACH ROW EXECUTE FUNCTION launchpad.reserve_production_wallets();
-- Owner-only backfill inside the migration transaction/DDL locks. Runtime retains RLS.
ALTER TABLE launchpad.production_senders NO FORCE ROW LEVEL SECURITY;
ALTER TABLE launchpad.production_wallets NO FORCE ROW LEVEL SECURITY;
INSERT INTO launchpad.production_wallets
 SELECT 4663,sender,project_id,module_id,'executor' FROM launchpad.production_senders;
INSERT INTO launchpad.production_wallets
 SELECT 4663,lower(policy_text::jsonb->>'publisher'),project_id,module_id,'publisher' FROM launchpad.production_senders;
ALTER TABLE launchpad.production_senders FORCE ROW LEVEL SECURITY;
ALTER TABLE launchpad.production_wallets FORCE ROW LEVEL SECURITY;
