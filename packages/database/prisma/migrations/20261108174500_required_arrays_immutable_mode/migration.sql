-- Prisma scalar lists do not express the required PostgreSQL column NOT NULL
-- guards. Preserve these statements and the existing cardinality checks in future
-- migrations; NULL must not be replaced with invented option order or worked steps.
-- Fail atomically if existing data needs an explicit, reviewed repair.
BEGIN;

ALTER TABLE "SessionItem" ALTER COLUMN "optionOrder" SET NOT NULL;
ALTER TABLE "ExplanationVersion" ALTER COLUMN "workedSteps" SET NOT NULL;

-- Item release rules depend on mode. Keep the parent mode fixed for the whole
-- lifetime of a session, including before items exist. Same-mode/state writes work.
CREATE FUNCTION protect_practice_session_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."mode" IS DISTINCT FROM OLD."mode" THEN
    RAISE EXCEPTION 'Session mode is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PracticeSession_mode_immutable"
BEFORE UPDATE OF "mode" ON "PracticeSession"
FOR EACH ROW EXECUTE FUNCTION protect_practice_session_mode();

COMMIT;
