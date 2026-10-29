import type { components } from "./schema";

export type ApiErrorCode = components["schemas"]["ErrorCode"];

/**
 * Editor-side copy for every error the cloud gateway can send. `satisfies Record<ApiErrorCode,…>`
 * makes this a compile error the moment Rust adds (or removes) a code and the types are
 * regenerated, so a new failure can never reach a user without a message written for it.
 */
const MESSAGES = {
  invalid_json: "That request wasn't valid JSON with an `operation` field.",
  payload_too_large: "That request is too large.",
  invalid_body: "That request couldn't be read.",
  unknown_operation: "Pictoe doesn't know that operation.",
  cloud_engine_unavailable:
    "This tool needs Pictoe's cloud engine, which isn't available yet. Your current edits remain safe.",
  invalid_job_id: "That isn't a valid job id.",
  job_not_found: "That job doesn't exist or has expired.",
  job_already_finished: "That job has already finished.",
  too_many_jobs: "The cloud engine is busy. Try again in a moment. Your current edits remain safe.",
  not_found: "There's nothing at that address.",
} satisfies Record<ApiErrorCode, string>;

const FALLBACK = "Something went wrong with the cloud engine. Your current edits remain safe.";

/** A message for a person. Accepts any string so a newer server's unknown code still gets a safe one. */
export function apiErrorMessage(code: string): string {
  return Object.prototype.hasOwnProperty.call(MESSAGES, code)
    ? MESSAGES[code as ApiErrorCode]
    : FALLBACK;
}
