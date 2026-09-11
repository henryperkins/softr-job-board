# Fresh email/password accounts

The user explicitly removed account migration from scope on September 11, 2026. Target users create fresh accounts with Better Auth email/password. Auth0, source-password transfer, migration invitations, legacy account claiming and automatic account linking are excluded.

## Ownership

After required email verification, a new Better Auth subject receives a new internal business user ID. Resource authorization uses that immutable ID, never a request-supplied owner or an email comparison. Changing an account name or password does not rewrite ownership.

Matching a historical Softr email does not grant access to its profiles, saved jobs, drafts or files. Source data and the administrative roster remain preserved in the protected export and local migration rehearsal. They are historical records, not login credentials or target access grants. No existing private records are automatically assigned to fresh accounts.

The retained source roster has six entries: one ACTIVATED and five NOT_INVITED. That inventory is archival evidence only; source account activation and browser account-control proofs are not prerequisites for creating fresh target accounts.

## Account lifecycle

Better Auth manages password creation and verification, secure sessions, email verification and password reset. The core local integration and security tests are implemented. Verification is required before private resource access, reset revokes sessions, logout invalidates its session, and a current-password-verified password change can revoke other sessions.

Public verification/reset requests do not reveal whether an account exists or claim that delivery succeeded. Disabled email configuration returns a uniform unavailable response before account lookup. With transport configured, accepted requests acknowledge receipt/attempt only and failures receive redacted audit metadata.

The user selected `no-reply@auth.lakefrontdev.com`. At `2026-09-11T14:33:39Z`, Cloudflare reported this sending domain enabled, six DNS records ready with no errors, and activity-log message previews disabled. The controller disabled that preview setting on the already-existing sender; it did not create the domain or change website routing. The account limit was 1,000 messages/day with zero sent. Staging and production now explicitly configure the native `EMAIL` binding with that exact sender allowlist, verified by a staging dry build; `MAIL_MODE` remains disabled until deployed verification/reset delivery is tested. No real verification or reset email has been sent in this implementation session.

Use the maintained library's [email guidance](https://better-auth.com/docs/concepts/email) and [database integration](https://better-auth.com/docs/concepts/database). No custom password hashing or recovery-token implementation is introduced.

## Acceptance

- Two fresh controlled target accounts pass ownership isolation through the UI, API, private files, background requests and enabled MCP operations.
- Signup cannot obtain private access before verification; verification and reset expiry/reuse behavior is tested.
- Staging proves verification/reset delivery with the configured sender and confirms session revocation.
- No email match, source roster record or retained legacy owner ID can claim another user's data.
- Exact deployment/resource evidence is recorded separately from local test results.

Legacy account-migration gates in the original attached plan are superseded by the user's correction. New-account security and email delivery remain in scope.
