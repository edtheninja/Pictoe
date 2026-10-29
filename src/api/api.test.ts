import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apiErrorMessage, type ApiErrorCode } from "@/api";
import { parseIntent } from "@/features/intent/parseIntent";

/** The same OpenAPI file the TypeScript types were generated from. */
const spec = JSON.parse(readFileSync("backend/openapi.json", "utf8"));
const specCodes: string[] = spec.components.schemas.ErrorCode.enum;
const specOperations: string[] = spec.components.schemas.Operation.enum;

describe("API contract", () => {
  it("has a message for every error code the service can send", () => {
    for (const code of specCodes) {
      expect(apiErrorMessage(code as ApiErrorCode).length, code).toBeGreaterThan(10);
      expect(apiErrorMessage(code)).not.toBe(apiErrorMessage("some_future_code"));
    }
  });

  it("falls back safely for a code from a newer server", () => {
    expect(apiErrorMessage("brand_new_code")).toMatch(/current edits remain safe/);
    expect(apiErrorMessage("toString")).toMatch(/current edits remain safe/); // not an Object.prototype hit
  });

  it("keeps every message free of raw codes and jargon", () => {
    for (const code of specCodes)
      expect(apiErrorMessage(code)).not.toMatch(/_|\b5\d\d\b|\b4\d\d\b/);
  });

  it("has an Intent Bar rule for every cloud operation, and none the service doesn't know", () => {
    const phrases = [
      "remove the car",
      "expand the frame",
      "replace the sky",
      "cut out the subject",
    ];
    const requested = phrases.map((p) => parseIntent(p).cloudOnly?.operation);
    const cloudOps = specOperations.filter((op) => op !== "noop").sort();
    expect([...requested].sort()).toEqual(cloudOps);
  });
});
