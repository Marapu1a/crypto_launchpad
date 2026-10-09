SET LOCAL ROLE lp_owner;
-- Operator registers an immutable binding; runtime cannot create or change it.
CREATE TABLE launchpad.qianqi_executors (
 project_id uuid PRIMARY KEY REFERENCES launchpad.projects(id),
 chain_id bigint NOT NULL CHECK(chain_id=4663),
 sender text NOT NULL CHECK(sender ~ '^0x[0-9a-f]{40}$'),
 binding_hash text NOT NULL CHECK(binding_hash ~ '^0x[0-9a-f]{64}$'),
 UNIQUE(chain_id,sender)
);
ALTER TABLE launchpad.qianqi_executors ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.qianqi_executors FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.qianqi_executors
 USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT ON launchpad.qianqi_executors TO lp_executor;

-- Public projection only. Private native journals and credentials stay outside SQL/API.
CREATE TABLE launchpad.qianqi_api_views (
 project_id uuid PRIMARY KEY REFERENCES launchpad.projects(id),
 config_hash text NOT NULL CHECK(config_hash ~ '^0x[0-9a-f]{64}$'),
 head_number bigint,head_hash text,view_text text,view_hash text,
 CHECK((head_number IS NULL AND head_hash IS NULL AND view_text IS NULL AND view_hash IS NULL) OR
       (head_number IS NOT NULL AND head_number>=0 AND head_hash IS NOT NULL AND head_hash ~ '^0x[0-9a-f]{64}$' AND view_text IS NOT NULL AND view_hash IS NOT NULL AND view_hash ~ '^[0-9a-f]{64}$'))
);
ALTER TABLE launchpad.qianqi_api_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.qianqi_api_views FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.qianqi_api_views
 USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT ON launchpad.qianqi_api_views TO lp_api,lp_jobs;
GRANT UPDATE(head_number,head_hash,view_text,view_hash) ON launchpad.qianqi_api_views TO lp_jobs;
