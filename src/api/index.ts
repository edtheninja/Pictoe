/**
 * Types for Pictoe's optional cloud gateway.
 *
 * `schema.d.ts` is generated from `backend/openapi.json`, which is generated from the Rust types
 * (`npm run api:types` after changing the API; CI fails if it is stale). Never edit it by hand.
 */
import type { components } from "./schema";

export type { components, paths } from "./schema";
export { apiErrorMessage } from "./errors";
export type { ApiErrorCode } from "./errors";

/** What the cloud gateway can be asked to do. */
export type ApiOperation = components["schemas"]["Operation"];
export type JobStatus = components["schemas"]["JobStatus"];
export type Job = components["schemas"]["JobView"];
export type ApiErrorBody = components["schemas"]["ErrorBody"];
