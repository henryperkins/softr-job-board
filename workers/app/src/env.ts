// Bindings derive from Wrangler; deployment secrets are supplied out of band.
export type AppEnv = Omit<
  Env,
  | "APP_ORIGIN"
  | "MAIL_MODE"
  | "MAIL_FROM"
  | "WRITES_ENABLED"
  | "GENERATION_ENABLED"
  | "MCP_ENABLED"
  | "MCP_WRITES_ENABLED"
  | "MCP_GENERATION_ENABLED"
  | "MCP_REVIEW_ENABLED"
> & {
  APP_ORIGIN: string;
  MAIL_MODE: string;
  MAIL_FROM: string;
  WRITES_ENABLED: string;
  GENERATION_ENABLED: string;
  MCP_ENABLED: string;
  MCP_WRITES_ENABLED: string;
  MCP_GENERATION_ENABLED: string;
  MCP_REVIEW_ENABLED: string;
  BETTER_AUTH_SECRET: string;
  EMAIL?: SendEmail;
};
