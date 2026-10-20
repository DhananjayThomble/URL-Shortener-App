import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import { dedupeIssuesByField, type ValidationIssue } from "@snapurl/contract";
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

   What the words are (#792): `message` is shown to people, so each entry is
   a plain sentence ("Name must be 80 characters or fewer") with no
   `field:` path in front of it, and there is at most one per field — a
   single bad value can trip several rules, and three contradictory lines
   for one box is worse than one. The wording itself lives in
   @snapurl/contract (friendly-errors.ts), so the web forms' own validation
   says the same thing. `issues` keeps the field path for clients that want
   to attach each message to its input.
   ============================================================ */

export interface ValidationErrorBody {
  statusCode: 400;
  error: "Bad Request";
  message: string[];
  issues: ValidationIssue[];
}

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const issues = dedupeIssuesByField(result.error.issues);
    const body: ValidationErrorBody = {
      statusCode: 400,
      error: "Bad Request",
      message: issues.map((i) => i.message),
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
