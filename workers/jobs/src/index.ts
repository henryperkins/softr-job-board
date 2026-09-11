import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { advanceIngestion, markFailure } from "./ingestion.ts";
import { dispatchSchedule, type IngestParams } from "./dispatcher.ts";
import { advanceGeneration, failGeneration } from "./generation";
import {
  dispatchGeneration,
  type GenerateParams,
} from "./generation-dispatcher";
import {
  failureCode,
  IngestionError,
  type ProviderSecrets,
} from "./providers.ts";
export type JobsEnv = JobsBindings &
  ProviderSecrets & { ANTHROPIC_API_KEY?: string };
export class GenerateDraftWorkflow extends WorkflowEntrypoint<
  JobsEnv,
  GenerateParams
> {
  async run(event: WorkflowEvent<GenerateParams>, step: WorkflowStep) {
    for (let n = 0; n < 3; n++) {
      const result = await step.do(
        `generation-${n}`,
        {
          retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
          timeout: "2 minutes",
        },
        () => advanceGeneration(this.env, event.payload.requestId),
      );
      if (result.done) return result;
      if (result.state === "stopped") return result;
      await step.sleep(`retry-delay-${n}`, "30 seconds");
    }
    return step.do("exhausted", () =>
      failGeneration(
        this.env.DB,
        event.payload.requestId,
        "workflow_step_limit",
      ),
    );
  }
}
export class IngestSourceWorkflow extends WorkflowEntrypoint<
  JobsEnv,
  IngestParams
> {
  async run(event: WorkflowEvent<IngestParams>, step: WorkflowStep) {
    // Each step commits at most one page/staging chunk/import chunk, then returns tiny metadata.
    for (let n = 0; n < 10000; n++) {
      const result = await step.do(
        `ingestion-${n}`,
        {
          retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
          timeout: "2 minutes",
        },
        async () => {
          try {
            return await advanceIngestion(this.env, event.payload.runId);
          } catch (e) {
            throw new NonRetryableError(failureCode(e));
          }
        },
      );
      if (result.done) return result;
    }
    await step.do("step-limit", () =>
      markFailure(
        this.env.DB,
        event.payload.runId,
        new IngestionError("workflow_step_limit"),
      ),
    );
    throw new NonRetryableError("workflow_step_limit");
  }
}
export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
  async scheduled(event, env) {
    // Minute dispatch gives user requests prompt service; acquisition remains hourly.
    const now = new Date(event.scheduledTime);
    const work = [dispatchGeneration(env, now)];
    if (now.getUTCMinutes() === 0) work.push(dispatchSchedule(env, now));
    await Promise.allSettled(work);
  },
} satisfies ExportedHandler<JobsEnv>;
