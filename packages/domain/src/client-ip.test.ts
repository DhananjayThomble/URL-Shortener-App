import { describe, expect, it } from "vitest";
import { clientIpFromXff } from "./client-ip.js";

/* The whole point of this parser is that a client cannot type its way to a
   different identity. CloudFront APPENDS the viewer IP to the right of any
   client-supplied X-Forwarded-For, so the trustworthy client is the
   (trustedHops+1)th entry from the RIGHT and anything prepended is ignored. */

describe("clientIpFromXff", () => {
  const socketIp = "10.0.0.1";

  it("selects the rightmost-minus-N entry for a realistic CloudFront chain", () => {
    // <attacker>, <attacker2>, <realclient>, <edge1>
    const xff = "1.1.1.1, 2.2.2.2, 203.0.113.9, 198.51.100.1";
    // One trusted appending hop (CloudFront) => real client is one from the right.
    expect(clientIpFromXff({ xff, socketIp, trustedHops: 1 })).toBe("203.0.113.9");
    // Two trusted hops => two from the right.
    expect(clientIpFromXff({ xff, socketIp, trustedHops: 2 })).toBe("2.2.2.2");
  });

  it("ignores entries the client PREPENDS — the derived IP is unchanged", () => {
    // A fixed, real chain: the client is 203.0.113.9 behind one trusted hop.
    const realChain = "203.0.113.9, 198.51.100.1";
    const honest = clientIpFromXff({ xff: realChain, socketIp, trustedHops: 1 });
    expect(honest).toBe("203.0.113.9");

    // The same request with the attacker prepending junk to spoof its identity.
    const spoofed = clientIpFromXff({
      xff: `9.9.9.9, 8.8.8.8, ${realChain}`,
      socketIp,
      trustedHops: 1,
    });
    // Prepended entries shift left and never touch the rightmost-minus-N slot.
    expect(spoofed).toBe(honest);
    expect(spoofed).toBe("203.0.113.9");
  });

  it("returns the socket IP when hops=0 even with an X-Forwarded-For present", () => {
    // Local dev / compose / direct-hit: no trusted appender, so trust the peer.
    expect(clientIpFromXff({ xff: "1.2.3.4, 5.6.7.8", socketIp, trustedHops: 0 })).toBe(socketIp);
  });

  it("returns the socket IP when there is no X-Forwarded-For header", () => {
    expect(clientIpFromXff({ xff: undefined, socketIp, trustedHops: 1 })).toBe(socketIp);
  });

  it("returns the socket IP for an empty or whitespace-only header", () => {
    expect(clientIpFromXff({ xff: "", socketIp, trustedHops: 1 })).toBe(socketIp);
    expect(clientIpFromXff({ xff: "   ,  , ", socketIp, trustedHops: 1 })).toBe(socketIp);
  });

  it("returns the socket IP when hops exceed the number of entries", () => {
    // Only two entries but three trusted hops claimed — the chain is shorter
    // than the topology, so fall back to the peer we can actually see.
    expect(clientIpFromXff({ xff: "1.1.1.1, 2.2.2.2", socketIp, trustedHops: 3 })).toBe(socketIp);
    // Exactly-equal count is also insufficient to index (N+1)th from the right.
    expect(clientIpFromXff({ xff: "1.1.1.1, 2.2.2.2", socketIp, trustedHops: 2 })).toBe(socketIp);
  });

  it("returns an IPv6 entry intact", () => {
    const xff = "2001:db8::1, 198.51.100.1";
    expect(clientIpFromXff({ xff, socketIp, trustedHops: 1 })).toBe("2001:db8::1");
  });

  it("handles the array form Fastify uses for a repeated header", () => {
    // X-Forwarded-For appearing twice arrives as an array.
    const xff = ["1.1.1.1, 203.0.113.9", "198.51.100.1"];
    expect(clientIpFromXff({ xff, socketIp, trustedHops: 1 })).toBe("203.0.113.9");
  });

  it("trims whitespace around the selected entry", () => {
    expect(clientIpFromXff({ xff: "  203.0.113.9  ,  198.51.100.1 ", socketIp, trustedHops: 1 })).toBe(
      "203.0.113.9",
    );
  });
});
