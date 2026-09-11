-- Additive generation ledger. Existing drafts remain editable during independent requests.
ALTER TABLE generation_requests ADD COLUMN intent_hash TEXT;
ALTER TABLE generation_requests ADD COLUMN failure_code TEXT;
ALTER TABLE generation_requests ADD COLUMN finished_at TEXT;
CREATE UNIQUE INDEX generation_owner_id ON generation_requests(id,user_id);
CREATE UNIQUE INDEX generation_one_inflight_save ON generation_requests(user_id,saved_job_id) WHERE state IN ('queued','running') AND intent_hash IS NOT NULL;
CREATE INDEX generation_owner_time ON generation_requests(user_id,created_at);
CREATE TRIGGER generation_request_intent_immutable BEFORE UPDATE OF id,user_id,saved_job_id,profile_id,profile_version_id,idempotency_key,intent_hash,workflow_id,created_at ON generation_requests WHEN OLD.intent_hash IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable_generation_intent'); END;
CREATE TABLE generation_inputs (
 request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, draft_id TEXT NOT NULL,
 saved_job_id TEXT NOT NULL, job_id TEXT NOT NULL, job_version_id TEXT NOT NULL REFERENCES job_versions(id),
 profile_id TEXT NOT NULL, profile_version_id TEXT NOT NULL,
 expected_revision INTEGER NOT NULL CHECK(expected_revision>0), expected_approved_revision INTEGER,
 job_hash TEXT NOT NULL, profile_hash TEXT NOT NULL,
 snapshot_key TEXT NOT NULL UNIQUE, snapshot_hash TEXT NOT NULL, snapshot_bytes INTEGER NOT NULL,
 model TEXT NOT NULL, contract TEXT NOT NULL, resume_contents_used INTEGER NOT NULL DEFAULT 0 CHECK(resume_contents_used=0),
 FOREIGN KEY(request_id,user_id) REFERENCES generation_requests(id,user_id),
 FOREIGN KEY(draft_id,user_id) REFERENCES draft_applications(id,user_id),
 FOREIGN KEY(saved_job_id,user_id) REFERENCES saved_jobs(id,user_id),
 FOREIGN KEY(profile_version_id,profile_id,user_id) REFERENCES profile_versions(id,profile_id,user_id)
);
CREATE TRIGGER generation_input_immutable BEFORE UPDATE ON generation_inputs BEGIN SELECT RAISE(ABORT,'immutable_generation_input'); END;
CREATE TRIGGER generation_input_no_delete BEFORE DELETE ON generation_inputs BEGIN SELECT RAISE(ABORT,'immutable_generation_input'); END;
CREATE TRIGGER generation_input_relationships BEFORE INSERT ON generation_inputs WHEN
 NOT EXISTS(SELECT 1 FROM generation_requests WHERE id=NEW.request_id AND user_id=NEW.user_id AND saved_job_id=NEW.saved_job_id AND profile_id=NEW.profile_id AND profile_version_id=NEW.profile_version_id) OR
 NOT EXISTS(SELECT 1 FROM draft_applications WHERE id=NEW.draft_id AND user_id=NEW.user_id AND saved_job_id=NEW.saved_job_id) OR
 NOT EXISTS(SELECT 1 FROM saved_jobs WHERE id=NEW.saved_job_id AND user_id=NEW.user_id AND job_id=NEW.job_id) OR
 NOT EXISTS(SELECT 1 FROM job_versions WHERE id=NEW.job_version_id AND job_id=NEW.job_id)
 BEGIN SELECT RAISE(ABORT,'generation_relationship_mismatch'); END;
CREATE TABLE generation_snapshots (
 request_id TEXT PRIMARY KEY REFERENCES generation_inputs(request_id),
 state TEXT NOT NULL CHECK(state IN ('pending','ready')), updated_at TEXT NOT NULL
);
CREATE TABLE generation_attempts (
 request_id TEXT NOT NULL REFERENCES generation_inputs(request_id), attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 2),
 state TEXT NOT NULL CHECK(state IN ('calling','stored','rejected','ambiguous')),
 model TEXT NOT NULL, response_model TEXT, started_at TEXT NOT NULL, finished_at TEXT,
 failure_code TEXT, provider_request_id TEXT, provider_message_id TEXT,
 finish_reason TEXT, usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
 response_key TEXT NOT NULL UNIQUE, response_hash TEXT, response_bytes INTEGER,
 PRIMARY KEY(request_id,attempt)
);
CREATE TABLE generation_results (
 request_id TEXT PRIMARY KEY REFERENCES generation_inputs(request_id), draft_version_id TEXT NOT NULL REFERENCES draft_versions(id),
 review_json TEXT NOT NULL CHECK(json_valid(review_json)), created_at TEXT NOT NULL
);
CREATE TRIGGER generation_result_immutable BEFORE UPDATE ON generation_results BEGIN SELECT RAISE(ABORT,'immutable_generation_result'); END;
CREATE TRIGGER generation_result_no_delete BEFORE DELETE ON generation_results BEGIN SELECT RAISE(ABORT,'immutable_generation_result'); END;
CREATE TABLE generation_write_guards(id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
