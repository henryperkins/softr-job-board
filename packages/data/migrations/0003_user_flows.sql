-- Reversible archival; historical roots, versions and file relationships remain intact.
ALTER TABLE candidate_profiles ADD COLUMN archived_at TEXT;
ALTER TABLE profile_versions ADD COLUMN archived_at TEXT;
ALTER TABLE active_profiles ADD COLUMN profile_version_id TEXT REFERENCES profile_versions(id);
UPDATE active_profiles SET profile_version_id=(SELECT id FROM profile_versions WHERE profile_id=active_profiles.profile_id AND user_id=active_profiles.user_id ORDER BY revision DESC LIMIT 1);
CREATE TRIGGER active_version_owner_insert BEFORE INSERT ON active_profiles WHEN NEW.profile_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profile_versions WHERE id=NEW.profile_version_id AND profile_id=NEW.profile_id AND user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'active_version_owner'); END;
CREATE TRIGGER active_version_owner_update BEFORE UPDATE ON active_profiles WHEN NEW.profile_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profile_versions WHERE id=NEW.profile_version_id AND profile_id=NEW.profile_id AND user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'active_version_owner'); END;
CREATE TRIGGER active_profile_version_after_insert AFTER INSERT ON profile_versions BEGIN UPDATE active_profiles SET profile_version_id=NEW.id WHERE profile_id=NEW.profile_id AND user_id=NEW.user_id; END;
CREATE INDEX saved_jobs_created_page ON saved_jobs(user_id,created_at DESC,id DESC);
CREATE INDEX attachment_profile_owner ON attachments(profile_id,user_id,created_at DESC,id DESC);
CREATE INDEX audit_actor_page ON audit_events(actor_user_id,created_at DESC,id DESC);

CREATE TABLE profile_create_requests (user_id TEXT NOT NULL REFERENCES users(id), idempotency_key TEXT NOT NULL, profile_id TEXT NOT NULL, PRIMARY KEY(user_id,idempotency_key), FOREIGN KEY(profile_id,user_id) REFERENCES candidate_profiles(id,user_id));
