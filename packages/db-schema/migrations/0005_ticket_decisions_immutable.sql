-- ticket_decisions değiştirilemez: karar kaydı UPDATE, DELETE ve TRUNCATE ile değişmez (spec §11, kullanıcı kararı).
-- forbid_log_mutation() 0001_immutable_logs.sql içinde tanımlı; burada yalnızca yeni tabloya bağlanır.
CREATE TRIGGER ticket_decisions_no_update_delete
  BEFORE UPDATE OR DELETE ON ticket_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_log_mutation();
--> statement-breakpoint
CREATE TRIGGER ticket_decisions_no_truncate
  BEFORE TRUNCATE ON ticket_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_log_mutation();
