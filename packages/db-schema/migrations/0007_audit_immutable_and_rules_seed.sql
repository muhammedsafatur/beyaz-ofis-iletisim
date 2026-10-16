-- audit_log değiştirilemez (spec §11). forbid_log_mutation() 0001_immutable_logs.sql içinde tanımlı.
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_log_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_log_mutation();
--> statement-breakpoint
-- §10 varsayılan yapılandırma: request_expiry 72 saat, access_window 24 saat, mesaj 60/dk, ticket 20/saat
INSERT INTO "approval_rules" ("id") VALUES (1);
