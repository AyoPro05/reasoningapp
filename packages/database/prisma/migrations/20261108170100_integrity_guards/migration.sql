-- Prisma cannot express these PostgreSQL constraints / triggers. Keep them when
-- generating future migrations; schema diff does not reproduce their semantics.
CREATE UNIQUE INDEX "PracticeSession_one_active_per_user"
ON "PracticeSession" ("userId")
WHERE "state" IN ('CREATED', 'IN_PROGRESS', 'SUBMITTED');

ALTER TABLE "Category" ADD CONSTRAINT "Category_known_id" CHECK ("id" IN ('inductive','logical','numerical','verbal','mechanical'));
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_positive_version" CHECK ("version" > 0);
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_development_origin" CHECK (
  ("contentState" = 'DEVELOPMENT') = (("provenance"->>'kind') IS NOT DISTINCT FROM 'ORIGINAL_DEVELOPMENT')
);
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_publication_date" CHECK (
  ("contentState" IN ('PUBLISHED','RETIRED') AND "publishedAt" IS NOT NULL) OR
  ("contentState" NOT IN ('PUBLISHED','RETIRED') AND "publishedAt" IS NULL)
);
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_position" CHECK ("position" >= 0 AND length(trim("text")) > 0 AND length(trim("optionKey")) > 0);
ALTER TABLE "ApprovedHint" ADD CONSTRAINT "ApprovedHint_stage" CHECK ("stage" BETWEEN 1 AND 3 AND length(trim("text")) > 0);
ALTER TABLE "ApprovedHint" ADD CONSTRAINT "ApprovedHint_review" CHECK (
  ("reviewStatus" = 'PENDING' AND "reviewerId" IS NULL AND "reviewedAt" IS NULL AND "publishedAt" IS NULL) OR
  ("reviewStatus" <> 'PENDING' AND "reviewerId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND ("publishedAt" IS NULL OR "reviewStatus" = 'APPROVED'))
);
ALTER TABLE "ExplanationVersion" ADD CONSTRAINT "ExplanationVersion_review" CHECK (
  "version" > 0 AND cardinality("workedSteps") > 0 AND length(trim("shortText")) > 0 AND (
  ("reviewStatus" = 'PENDING' AND "reviewerId" IS NULL AND "reviewedAt" IS NULL AND "publishedAt" IS NULL) OR
  ("reviewStatus" <> 'PENDING' AND "reviewerId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND ("publishedAt" IS NULL OR "reviewStatus" = 'APPROVED')))
);
ALTER TABLE "ContentReview" ADD CONSTRAINT "ContentReview_metadata" CHECK (
  ("status" = 'PENDING' AND "reviewerId" IS NULL AND "reviewedAt" IS NULL) OR
  ("status" <> 'PENDING' AND "reviewerId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
);
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_worked_example_release" CHECK ("solutionRelease" = 'WORKED_EXAMPLE' AND "version" > 0);
ALTER TABLE "AssessmentSection" ADD CONSTRAINT "AssessmentSection_positive" CHECK ("position" >= 0 AND "itemCount" > 0 AND ("durationSeconds" IS NULL OR "durationSeconds" > 0));
ALTER TABLE "SessionItem" ADD CONSTRAINT "SessionItem_position" CHECK ("position" >= 0 AND cardinality("optionOrder") >= 2);
ALTER TABLE "Response" ADD CONSTRAINT "Response_elapsed" CHECK ("elapsedMilliseconds" IS NULL OR "elapsedMilliseconds" >= 0);
ALTER TABLE "SessionResult" ADD CONSTRAINT "SessionResult_counts" CHECK (
  "total" >= 0 AND "correct" BETWEEN 0 AND "total" AND "independentAttempts" >= 0 AND "assistedAttempts" >= 0 AND
  "independentAttempts" + "assistedAttempts" = "total" AND "independentCorrect" BETWEEN 0 AND "independentAttempts" AND "independentCorrect" <= "correct"
);
ALTER TABLE "SkillProgress" ADD CONSTRAINT "SkillProgress_counts" CHECK (
  "independentAttempts" >= 0 AND "independentCorrect" BETWEEN 0 AND "independentAttempts" AND
  "assistedAttempts" >= 0 AND "assistedCorrect" BETWEEN 0 AND "assistedAttempts" AND
  "sampleSize" = "independentAttempts" + "assistedAttempts"
);
ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_interval" CHECK ("intervalDays" > 0);
ALTER TABLE "LearningSupportEvent" ADD CONSTRAINT "LearningSupportEvent_hint" CHECK (
  ("action" = 'HINT' AND "hintId" IS NOT NULL AND "hintStage" IS NOT NULL AND "hintStage" BETWEEN 1 AND 3 AND "assistanceStage" = 'BEFORE_ANSWER') OR
  ("action" <> 'HINT' AND "hintId" IS NULL AND "hintStage" IS NULL)
);
ALTER TABLE "TutorRequest" ADD CONSTRAINT "TutorRequest_preanswer_context" CHECK ("assistanceStage" <> 'BEFORE_ANSWER' OR "explanationVersionId" IS NULL);
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_valid" CHECK (length("key") BETWEEN 1 AND 128 AND length("requestHash") = 64 AND "responseStatus" BETWEEN 100 AND 599 AND "expiresAt" > "createdAt");

-- Lock the parent before changing any child. This serializes authoring edits with
-- publication; both the OLD and NEW parent are checked if a caller moves a row.
CREATE FUNCTION protect_question_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_record record;
  old_parent text;
  new_parent text;
  decision text;
  reviewer text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_parent := OLD."questionVersionId"; END IF;
  IF TG_OP <> 'DELETE' THEN new_parent := NEW."questionVersionId"; END IF;
  IF TG_TABLE_NAME IN ('ApprovedHint','ExplanationVersion') AND TG_OP <> 'INSERT' AND (to_jsonb(OLD)->>'publishedAt') IS NOT NULL THEN
    RAISE EXCEPTION 'Published support content is immutable' USING ERRCODE = '23514';
  END IF;
  FOR parent_record IN
    SELECT v."id", v."contentState", q."authorId"
    FROM "QuestionVersion" v JOIN "Question" q ON q."id" = v."questionId"
    WHERE v."id" IN (old_parent, new_parent) ORDER BY v."id" FOR UPDATE OF v
  LOOP
    IF parent_record."contentState" IN ('PUBLISHED','RETIRED') OR EXISTS (SELECT 1 FROM "SessionItem" WHERE "questionVersionId" = parent_record."id") THEN
      RAISE EXCEPTION 'Published or used question trees are immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP <> 'DELETE' AND TG_TABLE_NAME IN ('ApprovedHint','ExplanationVersion','ContentReview') THEN
      IF TG_TABLE_NAME = 'ContentReview' THEN decision := to_jsonb(NEW)->>'status'; ELSE decision := to_jsonb(NEW)->>'reviewStatus'; END IF;
      reviewer := to_jsonb(NEW)->>'reviewerId';
      IF decision <> 'PENDING' AND (parent_record."contentState" = 'DEVELOPMENT' OR parent_record."authorId" IS NULL OR reviewer = parent_record."authorId") THEN
        RAISE EXCEPTION 'Development content cannot claim review; independent reviewers are required' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "QuestionOption_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionOption" FOR EACH ROW EXECUTE FUNCTION protect_question_child();
CREATE TRIGGER "AnswerKey_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "AnswerKey" FOR EACH ROW EXECUTE FUNCTION protect_question_child();
CREATE TRIGGER "QuestionAsset_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionAsset" FOR EACH ROW EXECUTE FUNCTION protect_question_child();
CREATE TRIGGER "QuestionSkill_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionSkill" FOR EACH ROW EXECUTE FUNCTION protect_question_child();
CREATE TRIGGER "ContentReview_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ContentReview" FOR EACH ROW EXECUTE FUNCTION protect_question_child();
CREATE TRIGGER "ApprovedHint_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ApprovedHint" FOR EACH ROW EXECUTE FUNCTION protect_question_child();
CREATE TRIGGER "ExplanationVersion_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ExplanationVersion" FOR EACH ROW EXECUTE FUNCTION protect_question_child();

CREATE FUNCTION protect_question_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE author_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD."contentState" IN ('PUBLISHED','RETIRED') THEN
      -- Retirement is explicit; historical text, options, key and publication date stay fixed.
      IF TG_OP = 'UPDATE' AND OLD."contentState" = 'PUBLISHED' AND NEW."contentState" = 'RETIRED' AND
         (to_jsonb(OLD) - 'contentState') = (to_jsonb(NEW) - 'contentState') THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'Published question versions are immutable' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "SessionItem" WHERE "questionVersionId" = OLD."id") THEN
      RAISE EXCEPTION 'Used question versions are immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW."id" <> OLD."id" OR NEW."questionId" <> OLD."questionId" OR NEW."version" <> OLD."version") THEN
      RAISE EXCEPTION 'Version identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."contentState" = 'DEVELOPMENT' AND
       (NEW."contentState" <> 'DEVELOPMENT' OR NEW."provenance"->>'kind' IS DISTINCT FROM 'ORIGINAL_DEVELOPMENT') THEN
      RAISE EXCEPTION 'Development fixtures cannot be promoted or relabelled' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."contentState" IN ('PUBLISHED','RETIRED') THEN
    IF TG_OP = 'INSERT' OR NEW."contentState" = 'RETIRED' THEN
      RAISE EXCEPTION 'Publish a validated draft before retirement' USING ERRCODE = '23514';
    END IF;
    SELECT "authorId" INTO author_id FROM "Question" WHERE "id" = NEW."questionId";
    IF author_id IS NULL OR NEW."provenance"->>'kind' IS DISTINCT FROM 'ORIGINAL' OR
       (SELECT count(*) FROM "QuestionOption" WHERE "questionVersionId" = NEW."id") NOT BETWEEN 2 AND 10 OR
       NOT EXISTS (SELECT 1 FROM "AnswerKey" WHERE "questionVersionId" = NEW."id") OR
       (SELECT count(*) FROM "ApprovedHint" WHERE "questionVersionId" = NEW."id" AND "reviewStatus" = 'APPROVED' AND "publishedAt" IS NOT NULL AND "reviewerId" <> author_id) <> 3 OR
       NOT EXISTS (SELECT 1 FROM "ExplanationVersion" WHERE "questionVersionId" = NEW."id" AND "reviewStatus" = 'APPROVED' AND "publishedAt" IS NOT NULL AND "reviewerId" <> author_id) OR
       (SELECT count(*) FROM "ContentReview" WHERE "questionVersionId" = NEW."id" AND "stage" IN ('SUBJECT','EDITORIAL','HINT_DISCLOSURE') AND "status" = 'APPROVED' AND "reviewerId" <> author_id) <> 3 THEN
      RAISE EXCEPTION 'Independent content and support review is required before publication' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "QuestionVersion_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionVersion" FOR EACH ROW EXECUTE FUNCTION protect_question_version();

CREATE FUNCTION protect_question_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "QuestionVersion" WHERE "questionId" = OLD."id" ORDER BY "id" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "QuestionVersion" v WHERE v."questionId" = OLD."id" AND
    (v."contentState" IN ('PUBLISHED','RETIRED') OR EXISTS (SELECT 1 FROM "SessionItem" i WHERE i."questionVersionId" = v."id"))) THEN
    RAISE EXCEPTION 'Published or used question identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Question_immutable" BEFORE UPDATE OR DELETE ON "Question" FOR EACH ROW EXECUTE FUNCTION protect_question_identity();

CREATE FUNCTION validate_session_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_mode "SessionMode"; version_state "ContentState";
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    RAISE EXCEPTION 'Session item selection and release are immutable' USING ERRCODE = '23514';
  END IF;
  -- Same parent lock as authoring, to avoid a used version changing during item creation.
  SELECT "contentState" INTO version_state FROM "QuestionVersion" WHERE "id" = NEW."questionVersionId" FOR UPDATE;
  IF version_state NOT IN ('PUBLISHED','DEVELOPMENT') THEN
    RAISE EXCEPTION 'Session items require published or explicitly gated development content' USING ERRCODE = '23514';
  END IF;
  IF cardinality(NEW."optionOrder") <> (SELECT count(*) FROM "QuestionOption" WHERE "questionVersionId" = NEW."questionVersionId") OR
     cardinality(NEW."optionOrder") <> (SELECT count(DISTINCT k) FROM unnest(NEW."optionOrder") k) OR
     EXISTS (SELECT 1 FROM unnest(NEW."optionOrder") k WHERE NOT EXISTS (SELECT 1 FROM "QuestionOption" o WHERE o."questionVersionId" = NEW."questionVersionId" AND o."optionKey" = k)) THEN
    RAISE EXCEPTION 'Option order must contain each version option exactly once' USING ERRCODE = '23514';
  END IF;
  SELECT "mode" INTO session_mode FROM "PracticeSession" WHERE "id" = NEW."sessionId";
  IF session_mode IN ('MOCK','DAILY') AND NEW."solutionRelease" <> 'AFTER_SCORING' THEN
    RAISE EXCEPTION 'Mock and Daily solution release requires whole-session scoring' USING ERRCODE = '23514';
  END IF;
  IF NEW."solutionRelease" = 'WORKED_EXAMPLE' AND (session_mode <> 'LEARN' OR NOT EXISTS (
    SELECT 1 FROM "Lesson" WHERE "workedExampleQuestionVersionId" = NEW."questionVersionId"
  )) THEN
    RAISE EXCEPTION 'Worked-example release needs a designated lesson in Learn mode' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SessionItem_integrity" BEFORE INSERT OR UPDATE ON "SessionItem" FOR EACH ROW EXECUTE FUNCTION validate_session_item();
