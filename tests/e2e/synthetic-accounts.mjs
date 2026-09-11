// Isolated LOCAL synthetic fixtures. These are deliberately public test credentials.
// Never import this module from a Worker or use these identities for migration claims.
export const accounts = [
  {
    id: "synthetic-auth-a",
    owner: "synthetic-owner-a",
    name: "Test Candidate A",
    email: "candidate-a@example.test",
    password: "Synthetic-preview-only-123!",
  },
  {
    id: "synthetic-auth-b",
    owner: "synthetic-owner-b",
    name: "Test Candidate B",
    email: "candidate-b@example.test",
    password: "Synthetic-preview-only-123!",
  },
];
