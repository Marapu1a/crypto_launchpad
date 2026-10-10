SET LOCAL ROLE lp_owner;
ALTER TABLE launchpad.module_instances DROP CONSTRAINT module_instances_kind_check;
ALTER TABLE launchpad.module_instances ADD CONSTRAINT module_instances_kind_check CHECK(kind IN ('short','monthly','draw'));
