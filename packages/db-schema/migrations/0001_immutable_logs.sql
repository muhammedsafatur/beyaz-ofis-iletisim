-- access_log değiştirilemez (spec §3.6, §11). audit_log eklendiğinde aynı trigger'lar ona da bağlanır.
CREATE OR REPLACE FUNCTION forbid_log_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% tablosu değiştirilemez (%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER access_log_no_update_delete
  BEFORE UPDATE OR DELETE ON access_log
  FOR EACH ROW EXECUTE FUNCTION forbid_log_mutation();
--> statement-breakpoint
CREATE TRIGGER access_log_no_truncate
  BEFORE TRUNCATE ON access_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_log_mutation();
-- Uygulama rolü adı belirlenince: REVOKE UPDATE, DELETE, TRUNCATE ON access_log FROM <app_role>;
