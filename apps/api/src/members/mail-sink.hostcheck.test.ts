import { describe, expect, it } from "vitest";

/* #700 item 3a — the Newman mail-sink (qa/postman/mail-sink.mjs) is an
   unauthenticated loopback HTTP helper that runs while qa/postman/run.sh is
   executing. Without a Host-header check it is reachable via DNS-rebinding
   (a hostile page resolving its name to 127.0.0.1). isLoopbackHost is the
   pure allow/deny decision the server enforces before any token/backdate work.

   qa/ is NOT a pnpm workspace member, so this spec lives in the @snapurl/api
   lane (which runs vitest in CI and in-sandbox) and imports the helper from the
   mail-sink file over a relative path. Importing the module must NOT bind a
   port — the listen() call is guarded to the entrypoint only. */
import { isLoopbackHost } from "../../../../qa/postman/mail-sink.mjs";

describe("mail-sink isLoopbackHost (#700)", () => {
  it("accepts loopback hosts with or without a port", () => {
    for (const host of ["localhost:3099", "127.0.0.1:3099", "[::1]:3099", "localhost", "127.0.0.1"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("rejects non-loopback hosts (DNS-rebinding defence)", () => {
    for (const host of ["evil.example.com", "attacker.test:3099", "169.254.169.254"]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it("rejects a missing, empty or undefined Host header", () => {
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
    expect(isLoopbackHost(null as unknown as string)).toBe(false);
  });
});
