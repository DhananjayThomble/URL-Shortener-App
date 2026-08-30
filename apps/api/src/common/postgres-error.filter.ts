import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { isForeignKeyViolation, isUniqueViolation, postgresErrorCode } from "@snapurl/database";

/* ============================================================
   A backstop so a database constraint can never reach a user as
   "Internal server error".

   Drizzle 0.44 wraps driver errors in a DrizzleQueryError and puts
   the real PostgresError — the one carrying `code` — on `.cause`.
   Anything that checks `err.code` at the top level silently stops
   matching, which is exactly how a handled 409 turned into a 500.

   Services still catch the cases they can explain well (a taken
   back-half names the slug). This filter catches the ones nobody
   anticipated, and turns them into the right status code with a
   message that does not leak schema details.
   ============================================================ */

/* Re-exported, not redefined.
 *
 * These moved to @snapurl/database because the redirect and worker now need the
 * same cause-chain walk to recognise a transient partition-routing failure on the
 * click write. Two copies of it would be two things to keep in step, and the bug
 * this walk exists to prevent — a code sitting one level down being missed — is
 * exactly the kind that drift reintroduces. Re-exporting keeps every existing
 * importer in this app working unchanged. */
export { postgresErrorCode, isUniqueViolation, isForeignKeyViolation };

const STATUS_FOR: Record<string, { status: number; message: string }> = {
  "23505": { status: 409, message: "That already exists." },
  "23503": { status: 409, message: "Something this depends on doesn't exist, or is still in use." },
  "23502": { status: 400, message: "A required field was missing." },
  "22001": { status: 400, message: "One of those values is too long." },
  "23514": { status: 400, message: "One of those values isn't allowed." },
  "40001": { status: 409, message: "That conflicted with another change. Try again." },
  "57014": { status: 503, message: "That query took too long. Try a narrower date range." },
  "53300": { status: 503, message: "The database is busy. Try again in a moment." },
};

@Catch()
export class PostgresErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(PostgresErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    // Anything the application raised deliberately passes straight through.
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      void reply.status(exception.getStatus()).send(response);
      return;
    }

    const code = postgresErrorCode(exception);
    const mapped = code ? STATUS_FOR[code] : undefined;

    if (mapped) {
      // Logged at warn, not error: it is a client problem we simply did not
      // have a specific message for.
      this.logger.warn({ code }, "database constraint surfaced to the client");
      void reply.status(mapped.status).send({
        statusCode: mapped.status,
        error: mapped.status === 409 ? "Conflict" : "Bad Request",
        message: mapped.message,
      });
      return;
    }

    this.logger.error({ err: exception }, "unhandled exception");
    void reply.status(500).send({
      statusCode: 500,
      error: "Internal Server Error",
      message: "The API is having trouble. Try again in a moment.",
    });
  }
}
