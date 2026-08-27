import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import { z } from "zod";

/* ============================================================
   Validation against the shared contract.

   DECISIONS.md originally named nestjs-zod for this. I wrote the
   pipe by hand instead: it is twenty lines, it removes a
   dependency whose zod-v4 support would have to track zod's
   releases, and — the deciding reason — it lets the error body
   match the shape web/src/lib/api/client.ts already parses.

   That client reads `message` as either a string or an array of
   strings and joins them. Anything else renders as a bare status
   code in the UI, so the error format is part of the contract
   whether or not the contract file says so.
   ============================================================ */

export interface ValidationErrorBody {
  statusCode: 400;
  error: "Bad Request";
  message: string[];
  issues: Array<{ path: string; message: string }>;
}

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));

    // Name the field in the message — "destination: That doesn't look like a
    // URL" is actionable where "Bad Request" is not.
    const body: ValidationErrorBody = {
      statusCode: 400,
      error: "Bad Request",
      message: issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)),
      issues,
    };
    throw new BadRequestException(body);
  }
}

/** `@Body(zodBody(CreateLinkInput)) input: CreateLinkInput` */
export function zodBody<T>(schema: z.ZodType<T>) {
  return new ZodValidationPipe(schema);
}

/** Query strings arrive as strings, so query schemas need z.coerce on numbers. */
export function zodQuery<T>(schema: z.ZodType<T>) {
  return new ZodValidationPipe(schema);
}
