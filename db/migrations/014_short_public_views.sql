SET LOCAL ROLE lp_owner;
CREATE TABLE launchpad.short_public_views (
 project_id uuid NOT NULL,
 module_id uuid NOT NULL,
 source_revision bigint,
 snapshot jsonb,
 observed_at timestamptz,
 service_status text NOT NULL CHECK(service_status IN ('paused','blocked','busy','waiting','confirmed','already-confirmed','idle')),
 service_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 projection_failed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(project_id,module_id),
 FOREIGN KEY(project_id,module_id) REFERENCES launchpad.module_instances(project_id,id)
);
ALTER TABLE launchpad.short_public_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchpad.short_public_views FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON launchpad.short_public_views
 USING(project_id=launchpad.current_project()) WITH CHECK(project_id=launchpad.current_project());
GRANT SELECT ON launchpad.short_public_views TO lp_api,lp_executor;
GRANT INSERT,UPDATE ON launchpad.short_public_views TO lp_executor;
