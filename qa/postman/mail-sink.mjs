#!/usr/bin/env node
/* ============================================================
   Local mail sink + fixture helper for the Newman run (#668).

   The staging stack's API runs with MAIL_TRANSPORT=outbox, which writes each
   email to a file inside the api container (docker-compose.staging.yml, D2).
   A Postman collection cannot reach into a container, so this tiny server
   does it for the collection over loopback HTTP:

     GET  /token?to=<email>&kind=invite|verify|reset
          → { token }  from the newest outbox mail to <email> whose link is
            /invite, /verify-email or /reset-password. Polls up to ~5s.
     POST /backdate-invite?email=<email>&days=<n>
          → sets memberships.invited_at to n days ago for that pending invite,
            so the 7-day expiry is testable without waiting a week.

   Test-only, never part of the product. Binds 127.0.0.1 only. No real mail
   is ever sent — the stack has no SMTP transport at all. Started and stopped
   by qa/postman/run.sh.
   ============================================================ */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const PORT = Number(process.env.MAIL_SINK_PORT ?? 3099);
const API_CONTAINER = process.env.QA_API_CONTAINER ?? "snapurl-staging-api-1";
const DB_CONTAINER = process.env.DB_CONTAINER ?? "snapurl-staging-postgres";
const PATHS = { invite: "/invite?token=", verify: "/verify-email?token=", reset: "/reset-password?token=" };
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/* The sink binds 127.0.0.1 only, but a hostile page can still reach it via
   DNS-rebinding: it resolves its own name to 127.0.0.1 and the browser sends
   that name in the Host header. Pin the request to a loopback Host so only
   genuinely local callers (newman, curl) get past this gate. Exported so the
   @snapurl/api vitest lane can unit-test the allow/deny decision. */
export function isLoopbackHost(hostHeader) {
  if (typeof hostHeader !== "string" || hostHeader === "") return false;
  // Strip the optional :port. [::1]:3099 → ::1, 127.0.0.1:3099 → 127.0.0.1.
  let host = hostHeader.trim();
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close === -1) return false;
    host = host.slice(1, close);
  } else {
    const colon = host.indexOf(":");
    if (colon !== -1) host = host.slice(0, colon);
  }
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

async function latestToken(to, kind) {
  const sanitized = to.replace(/[^a-z0-9]/gi, "_");
  const marker = PATHS[kind];
  for (let i = 0; i < 20; i++) {
    try {
      // Newest first by the filename's leading Date.now() (MailService.send).
      const { stdout } = await run("docker", [
        "exec", API_CONTAINER, "sh", "-c",
        `ls /tmp/snapurl-outbox/ 2>/dev/null | grep -F -- '-${sanitized}.txt' | sort -t- -k1,1 -n -r`,
      ]);
      for (const name of stdout.split("\n").filter(Boolean)) {
        const { stdout: body } = await run("docker", ["exec", API_CONTAINER, "cat", `/tmp/snapurl-outbox/${name}`]);
        const at = body.indexOf(marker);
        if (at === -1) continue;
        const match = body.slice(at + marker.length).match(/^([^\s&]+)/);
        if (match) return decodeURIComponent(match[1]);
      }
    } catch {
      /* container busy or no files yet — retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function backdateInvite(email, days) {
  // Value goes in as a psql variable (:'email'), never spliced into SQL.
  const sql = `update memberships set invited_at = now() - (:'days' || ' days')::interval where lower(email) = lower(:'email') and status = 'invited';`;
  const child = execFile("docker", [
    "exec", "-i", DB_CONTAINER, "psql", "-U", "snapurl", "-d", "snapurl", "-v", "ON_ERROR_STOP=1",
    "-v", `email=${email}`, "-v", `days=${days}`, "-tA",
  ]);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stdin.end(sql);
  const code = await new Promise((r) => child.on("close", r));
  const updated = Number(out.match(/UPDATE (\d+)/)?.[1] ?? 0);
  return { code, updated };
}

async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // DNS-rebinding defence: refuse any request not addressed to a loopback host
  // before touching the outbox or the database.
  if (!isLoopbackHost(req.headers.host)) return send(403, { error: "forbidden host" });
  try {
    if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true });
    if (req.method === "GET" && url.pathname === "/token") {
      const to = url.searchParams.get("to") ?? "";
      const kind = url.searchParams.get("kind") ?? "invite";
      if (!EMAIL.test(to) || !(kind in PATHS)) return send(400, { error: "bad to/kind" });
      const token = await latestToken(to, kind);
      return token ? send(200, { token }) : send(404, { error: `no ${kind} mail for ${to}` });
    }
    if (req.method === "POST" && url.pathname === "/backdate-invite") {
      const email = url.searchParams.get("email") ?? "";
      const days = Number(url.searchParams.get("days") ?? "8");
      if (!EMAIL.test(email) || !Number.isInteger(days) || days < 0 || days > 365) return send(400, { error: "bad email/days" });
      const result = await backdateInvite(email, days);
      return send(result.code === 0 ? 200 : 500, result);
    }
    send(404, { error: "not found" });
  } catch (err) {
    send(500, { error: String(err) });
  }
}

// Only bind a port when run directly (qa/postman/run.sh runs this file as the
// entrypoint). Importing the module — e.g. from the @snapurl/api unit test that
// exercises isLoopbackHost — must have no listening side effect.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  createServer(handle).listen(PORT, "127.0.0.1", () => console.log(`mail-sink listening on http://127.0.0.1:${PORT}`));
}
