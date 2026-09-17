-- Make activity_logs append-only.
--
-- Revoking UPDATE/DELETE from the application role is not enough on its own: the
-- role that runs migrations owns the table, and a table owner bypasses its own
-- grants. A trigger holds regardless of who connects, including the owner and a
-- compromised API process, so the audit trail cannot be rewritten in place.
--
-- Retention/erasure (DPDP Act) is handled by a scheduled job running as a
-- separate maintenance role that temporarily disables this trigger, not by
-- granting the application delete rights.

CREATE OR REPLACE FUNCTION webedge_activity_logs_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'activity_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activity_logs_no_update
  BEFORE UPDATE ON activity_logs
  FOR EACH STATEMENT EXECUTE FUNCTION webedge_activity_logs_append_only();

CREATE TRIGGER activity_logs_no_delete
  BEFORE DELETE ON activity_logs
  FOR EACH STATEMENT EXECUTE FUNCTION webedge_activity_logs_append_only();
