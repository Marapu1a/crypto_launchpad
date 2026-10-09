-- Dedicated database. Bootstrap lp_owner, lp_api and lp_jobs separately.
SET LOCAL ROLE lp_owner;
CREATE SCHEMA launchpad AUTHORIZATION lp_owner;
REVOKE ALL ON SCHEMA launchpad FROM PUBLIC;
CREATE TABLE launchpad.schema_migrations (version integer PRIMARY KEY, checksum text NOT NULL);
CREATE TABLE launchpad.projects (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{1,50}$'),
  display_name text NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  token_address text NOT NULL CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
  status text NOT NULL CHECK (status IN ('test', 'shadow', 'paused')),
  UNIQUE(chain_id, token_address)
);
CREATE TABLE launchpad.project_domains (
  hostname text PRIMARY KEY CHECK (hostname = lower(hostname) AND hostname ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'),
  project_id uuid NOT NULL REFERENCES launchpad.projects(id)
);
CREATE TABLE launchpad.module_instances (
  project_id uuid NOT NULL REFERENCES launchpad.projects(id),
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('short', 'monthly')),
  adapter_version text NOT NULL,
  program_address text NOT NULL CHECK (program_address ~ '^0x[0-9a-f]{40}$'),
  config_hash text NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(project_id,id)
);
CREATE TABLE launchpad.project_cursors (
  project_id uuid NOT NULL,
  module_id uuid NOT NULL,
  block_number numeric(78,0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  PRIMARY KEY(project_id,module_id),
  FOREIGN KEY(project_id,module_id) REFERENCES launchpad.module_instances(project_id,id)
);
CREATE TABLE launchpad.jobs (
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  module_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'refresh-view'),
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  PRIMARY KEY(project_id,id),
  UNIQUE(project_id,dedupe_key),
  FOREIGN KEY(project_id,module_id) REFERENCES launchpad.module_instances(project_id,id)
);

CREATE FUNCTION launchpad.current_project() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog
  AS $$ SELECT NULLIF(current_setting('launchpad.project_id',true),'')::uuid $$;

-- Domains are a public routing allowlist, not an authentication mechanism.
-- No general SELECT on the routing table is granted to runtime roles.
CREATE FUNCTION launchpad.resolve_host(host text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT project_id FROM launchpad.project_domains WHERE hostname = host $$;
REVOKE ALL ON FUNCTION launchpad.resolve_host(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION launchpad.current_project() FROM PUBLIC;

ALTER TABLE launchpad.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.projects FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.projects USING (id=launchpad.current_project()) WITH CHECK (id=launchpad.current_project());
ALTER TABLE launchpad.module_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.module_instances FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.module_instances USING (project_id=launchpad.current_project()) WITH CHECK (project_id=launchpad.current_project());
ALTER TABLE launchpad.project_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.project_cursors FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.project_cursors USING (project_id=launchpad.current_project()) WITH CHECK (project_id=launchpad.current_project());
ALTER TABLE launchpad.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.jobs USING (project_id=launchpad.current_project()) WITH CHECK (project_id=launchpad.current_project());

GRANT USAGE ON SCHEMA launchpad TO lp_api,lp_jobs;
GRANT EXECUTE ON FUNCTION launchpad.current_project() TO lp_api,lp_jobs;
GRANT EXECUTE ON FUNCTION launchpad.resolve_host(text) TO lp_api;
GRANT SELECT ON launchpad.projects,launchpad.module_instances,launchpad.project_cursors TO lp_api;
GRANT SELECT ON launchpad.projects,launchpad.module_instances,launchpad.project_cursors,launchpad.jobs TO lp_jobs;
GRANT INSERT,UPDATE ON launchpad.project_cursors,launchpad.jobs TO lp_jobs;
