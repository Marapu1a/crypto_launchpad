SET LOCAL ROLE lp_owner;
-- Bootstrap lp_executor separately; API/jobs must never read signed intents.
CREATE TABLE launchpad.financial_executors (
 project_id uuid NOT NULL,module_id uuid NOT NULL,
 local_instance text NOT NULL CHECK(local_instance ~ '^0x[0-9a-f]{64}$'),
 sender text NOT NULL CHECK(sender ~ '^0x[0-9a-f]{40}$'),
 config_text text NOT NULL,config_hash text NOT NULL CHECK(config_hash ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(project_id,module_id), UNIQUE(local_instance,sender),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.module_instances(project_id,id)
);
CREATE TABLE launchpad.financial_operations (
 project_id uuid NOT NULL,module_id uuid NOT NULL,operation_id text NOT NULL CHECK(operation_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 request_text text NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 intent_text text NOT NULL,intent_hash text NOT NULL CHECK(intent_hash ~ '^[0-9a-f]{64}$'),
 tx_hash text NOT NULL CHECK(tx_hash ~ '^0x[0-9a-f]{64}$'),nonce bigint NOT NULL CHECK(nonce>=0),
 status text NOT NULL CHECK(status IN ('prepared','confirmed','reverted')),
 result_text text,result_hash text,
 PRIMARY KEY(project_id,module_id,operation_id), UNIQUE(project_id,module_id,nonce),UNIQUE(tx_hash),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.financial_executors(project_id,module_id),
 CHECK((status='prepared' AND result_text IS NULL AND result_hash IS NULL) OR
       (status<>'prepared' AND result_text IS NOT NULL AND result_hash ~ '^[0-9a-f]{64}$'))
);
CREATE UNIQUE INDEX one_pending_financial_operation ON launchpad.financial_operations(project_id,module_id) WHERE status='prepared';
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['financial_executors','financial_operations'] LOOP
  EXECUTE format('ALTER TABLE launchpad.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE launchpad.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY project_scope ON launchpad.%I USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project())',t);
  EXECUTE format('GRANT SELECT,INSERT ON launchpad.%I TO lp_executor',t);
 END LOOP;
END $$;
GRANT UPDATE(status,result_text,result_hash) ON launchpad.financial_operations TO lp_executor;
GRANT USAGE ON SCHEMA launchpad TO lp_executor;
GRANT EXECUTE ON FUNCTION launchpad.current_project() TO lp_executor;
GRANT SELECT ON launchpad.projects,launchpad.module_instances TO lp_executor;
