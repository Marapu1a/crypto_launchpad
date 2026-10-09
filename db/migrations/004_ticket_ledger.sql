SET LOCAL ROLE lp_owner;
CREATE TABLE launchpad.ticket_ledgers (
 project_id uuid NOT NULL, module_id uuid NOT NULL,
 source_id uuid NOT NULL REFERENCES launchpad.chain_sources(id),
 profile_text text NOT NULL CHECK(jsonb_typeof(profile_text::jsonb)='object'),
 profile_hash text NOT NULL CHECK(profile_hash ~ '^[0-9a-f]{64}$'),
 cursor_number bigint NOT NULL CHECK(cursor_number>=0),
 cursor_hash text NOT NULL CHECK(cursor_hash ~ '^0x[0-9a-f]{64}$'),
 PRIMARY KEY(project_id,module_id),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.module_instances(project_id,id)
);
CREATE TABLE launchpad.ticket_events (
 project_id uuid NOT NULL,module_id uuid NOT NULL,candidate_id text NOT NULL,
 block_number bigint NOT NULL CHECK(block_number>=0),
 payload_text text NOT NULL,payload_hash text NOT NULL,
 PRIMARY KEY(project_id,module_id,candidate_id),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.ticket_ledgers(project_id,module_id)
);
CREATE TABLE launchpad.ticket_credits (
 project_id uuid NOT NULL,module_id uuid NOT NULL,candidate_id text NOT NULL,
 wallet text NOT NULL CHECK(wallet ~ '^0x[0-9a-f]{40}$'),
 amount numeric NOT NULL CHECK(amount>0 AND amount=trunc(amount)),
 credited_block bigint NOT NULL CHECK(credited_block>=0),
 event_text text NOT NULL,event_hash text NOT NULL,
 PRIMARY KEY(project_id,module_id,candidate_id),
 FOREIGN KEY(project_id,module_id,candidate_id) REFERENCES launchpad.ticket_events(project_id,module_id,candidate_id)
);
CREATE INDEX ticket_credit_cutoff ON launchpad.ticket_credits(project_id,module_id,credited_block,wallet);
CREATE TABLE launchpad.ticket_wallets (
 project_id uuid NOT NULL,module_id uuid NOT NULL,wallet text NOT NULL CHECK(wallet ~ '^0x[0-9a-f]{40}$'),
 spent numeric NOT NULL CHECK(spent>=0 AND spent=trunc(spent)),
 PRIMARY KEY(project_id,module_id,wallet),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.ticket_ledgers(project_id,module_id)
);
CREATE TABLE launchpad.ticket_commitments (
 project_id uuid NOT NULL,module_id uuid NOT NULL,bundle_hash text NOT NULL CHECK(bundle_hash ~ '^0x[0-9a-f]{64}$'),
 block_number bigint NOT NULL CHECK(block_number>=0),proof_text text NOT NULL,
 PRIMARY KEY(project_id,module_id,bundle_hash),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.ticket_ledgers(project_id,module_id)
);
CREATE TABLE launchpad.ticket_snapshots (
 project_id uuid NOT NULL,module_id uuid NOT NULL,label text NOT NULL CHECK(label ~ '^[A-Za-z0-9_-]{1,80}$'),
 cutoff bigint NOT NULL CHECK(cutoff>=0),input_hash text NOT NULL,snapshot_text text NOT NULL,
 PRIMARY KEY(project_id,module_id,label),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.ticket_ledgers(project_id,module_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ticket_ledgers','ticket_events','ticket_credits','ticket_wallets','ticket_commitments','ticket_snapshots'] LOOP
  EXECUTE format('ALTER TABLE launchpad.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE launchpad.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY project_scope ON launchpad.%I USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project())',t);
  EXECUTE format('GRANT SELECT,INSERT ON launchpad.%I TO lp_jobs',t);
 END LOOP;
END $$;
GRANT UPDATE(cursor_number,cursor_hash) ON launchpad.ticket_ledgers TO lp_jobs;
GRANT UPDATE(spent) ON launchpad.ticket_wallets TO lp_jobs;
