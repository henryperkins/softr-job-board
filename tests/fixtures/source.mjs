export function sourceFixture() {
  const row = (id, fields) => ({
    id,
    fields,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-10T11:00:00Z",
  });
  const table = (id, name, fields, records) => ({
    id,
    name,
    fields: fields.map(([id, name, type]) => ({ id, name, type })),
    recordsCount: records.length,
    records,
  });
  return {
    schemaVersion: 1,
    exportStartedAt: "2026-09-11T10:00:00Z",
    exportEndedAt: "2026-09-11T10:01:00Z",
    quiescent: false,
    authRoster: {
      users: [
        {
          id: "auth-a",
          email: "a@example.test",
          status: "ACTIVATED",
          active: true,
        },
        {
          id: "auth-b",
          email: "b@example.test",
          status: "NOT_INVITED",
          active: true,
        },
      ],
      total: 2,
      hasMore: false,
    },
    tables: [
      table(
        "users",
        "Users",
        [
          ["email", "Email", "EMAIL"],
          ["name", "Name", "SINGLE_LINE_TEXT"],
          ["skills", "Skills", "SINGLE_LINE_TEXT"],
        ],
        [
          row("user-a", {
            email: "a@example.test",
            name: "Candidate A",
            skills: "Extra source field",
          }),
          row("user-b", { email: "b@example.test", name: "Candidate B" }),
        ],
      ),
      table(
        "profiles",
        "Candidate Profile",
        [
          ["owner", "Owner", "LINKED_RECORD"],
          ["name", "Full Name", "SINGLE_LINE_TEXT"],
          ["summary", "Summary", "LONG_TEXT"],
        ],
        [
          row("profile-a", {
            owner: { id: "user-a" },
            name: "Candidate A",
            summary: "Evidence from candidate",
          }),
        ],
      ),
      table(
        "jobs",
        "Job Listings",
        [
          ["title", "Job Title", "SINGLE_LINE_TEXT"],
          ["company", "Company", "SINGLE_LINE_TEXT"],
          ["status", "Job Status", "SELECT"],
          ["url", "Source Job URL", "URL"],
          ["currency", "Salary Currency", "SINGLE_LINE_TEXT"],
        ],
        [
          row("job-a", {
            title: "Engineer",
            company: "Example",
            status: { label: "Open" },
            url: "https://jobs.example.test/1",
            currency: "",
          }),
        ],
      ),
      table(
        "saves",
        "Saved Jobs",
        [
          ["owner", "User", "LINKED_RECORD"],
          ["job", "Job", "LINKED_RECORD"],
          ["status", "Status", "SELECT"],
          ["notes", "Notes", "LONG_TEXT"],
          ["archived", "Archived", "CHECKBOX"],
        ],
        [
          row("save-a", {
            owner: { id: "user-a" },
            job: { id: "job-a" },
            status: { label: "Saved" },
            notes: "Keep this note",
            archived: false,
          }),
        ],
      ),
      table(
        "drafts",
        "Draft Applications",
        [
          ["owner", "User", "LINKED_RECORD"],
          ["save", "Saved Job", "LINKED_RECORD"],
          ["status", "Draft Status", "SELECT"],
          ["letter", "Cover Letter", "LONG_TEXT"],
        ],
        [
          row("draft-a", {
            owner: { id: "user-a" },
            save: { id: "save-a" },
            status: { label: "Approved" },
            letter: "Legacy text; provenance unknown",
          }),
        ],
      ),
    ],
  };
}
