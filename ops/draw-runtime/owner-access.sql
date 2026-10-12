-- Run as database administrator in launchpad_shadow after migrations 001-015.
-- Private owner UI registration role, separate from runtime and table ownership.
BEGIN;
CREATE ROLE lp_owner_ui LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE launchpad_shadow TO lp_owner_ui;
GRANT USAGE ON SCHEMA launchpad TO lp_owner_ui;
GRANT EXECUTE ON FUNCTION launchpad.current_project() TO lp_owner_ui;
GRANT SELECT ON launchpad.schema_migrations,launchpad.projects,launchpad.module_instances,launchpad.production_wallets TO lp_owner_ui;
GRANT INSERT ON launchpad.projects,launchpad.module_instances TO lp_owner_ui;
-- Global conflict checks see only project metadata and reserved public addresses.
CREATE POLICY owner_ui_conflict_read ON launchpad.projects FOR SELECT TO lp_owner_ui USING(true);
CREATE POLICY owner_ui_wallet_read ON launchpad.production_wallets FOR SELECT TO lp_owner_ui USING(true);
-- Inserts and module reads retain existing project_scope policies.
COMMIT;
