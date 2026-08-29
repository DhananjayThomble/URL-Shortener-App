import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { createPublicKey, type KeyObject } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { ENV, type Env } from "../config/env.js";

/* ============================================================
   Verifying an ID token from Google or Apple.

   No new dependency: Node's crypto imports a JWK directly, and
   the JwtService already here does the signature check. The
   provider's public keys are fetched over HTTPS and cached.

   Everything below is written on the assumption that the token
   is hostile until every claim has been checked, because it
   arrives from the browser and the only thing standing between
   a forged one and a session is this file.
   ============================================================ */

export interface OAuthProfile {
  /** The `sub` claim — the provider's stable id for this person. */
  subject: string;
  email: string;
  /** Only a provider-asserted true permits linking to an existing account. */
  emailVerified: boolean;
  name: string | null;
}

interface ProviderConfig {
  /** Non-empty tuple: the verifier's `issuer` option will not accept a possibly-empty array. */
  issuers: [string, ...string[]];
  jwksUri: string;
  algorithms: string[];
  audience: string | undefined;
}

export const OAUTH_PROVIDERS = ["google", "apple"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** How long a fetched key set is trusted before being fetched again. */
const JWKS_TTL_MS = 60 * 60 * 1000;

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly cache = new Map<OAuthProvider, { keys: Jwk[]; fetchedAt: number }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
  ) {}

  private config(provider: OAuthProvider): ProviderConfig {
    return provider === "google"
      ? {
          // Google issues both spellings and has done for years.
          issuers: ["https://accounts.google.com", "accounts.google.com"],
          jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
          algorithms: ["RS256"],
          audience: this.env.GOOGLE_OAUTH_CLIENT_ID,
        }
      : {
          issuers: ["https://appleid.apple.com"],
          jwksUri: "https://appleid.apple.com/auth/keys",
          algorithms: ["ES256", "RS256"],
          audience: this.env.APPLE_OAUTH_CLIENT_ID,
        };
  }

  /** A provider with no client id configured is switched off, not misconfigured. */
  enabled(provider: OAuthProvider): boolean {
    return Boolean(this.config(provider).audience);
  }

  get enabledProviders(): OAuthProvider[] {
    return OAUTH_PROVIDERS.filter((p) => this.enabled(p));
  }

  private async keysFor(provider: OAuthProvider, force = false): Promise<Jwk[]> {
    const hit = this.cache.get(provider);
    if (!force && hit && Date.now() - hit.fetchedAt < JWKS_TTL_MS) return hit.keys;

    const { jwksUri } = this.config(provider);
    const res = await fetch(jwksUri, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new UnauthorizedException("Could not reach the sign-in provider. Try again.");

    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = body.keys ?? [];
    this.cache.set(provider, { keys, fetchedAt: Date.now() });
    return keys;
  }

  /**
   * Find the signing key named by the token's header.
   *
   * Refetches once on a miss, because providers rotate keys without warning
   * and a cached set is the ordinary reason a valid token looks unsigned.
   */
  private async keyFor(provider: OAuthProvider, kid: string): Promise<string> {
    for (const force of [false, true]) {
      const jwk = (await this.keysFor(provider, force)).find((k) => k.kid === kid);
      if (jwk) {
        const key: KeyObject = createPublicKey({ key: jwk as never, format: "jwk" });
        // Exported to PEM because the verifier's types accept a string or a
        // Buffer, not a KeyObject. The conversion is lossless for a public key.
        return key.export({ type: "spki", format: "pem" }) as string;
      }
    }
    throw new UnauthorizedException("That sign-in token was not signed by a key we recognise.");
  }

  /**
   * Verify an ID token and return only what we are willing to act on.
   *
   * Throws for anything short of a complete match. There is deliberately no
   * "mostly valid" path.
   */
  async verify(provider: OAuthProvider, idToken: string): Promise<OAuthProfile> {
    const { issuers, algorithms, audience } = this.config(provider);
    if (!audience) throw new UnauthorizedException(`${provider} sign-in is not configured.`);

    const kid = readKid(idToken);
    if (!kid) throw new UnauthorizedException("That sign-in token is malformed.");

    const key = await this.keyFor(provider, kid);

    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync(idToken, {
        publicKey: key,
        // Pinned explicitly, all three. Left to the library, `algorithms`
        // defaults to permitting any — including "none" in some versions —
        // and an unpinned audience would accept a token minted for a
        // different application entirely.
        algorithms: algorithms as never,
        audience,
        issuer: issuers,
      });
    } catch {
      throw new UnauthorizedException("That sign-in token is not valid.");
    }

    const profile = toProfile(claims);
    if (!profile) throw new UnauthorizedException("The sign-in provider did not return an email address.");
    return profile;
  }
}

/** The `kid` from a JWT header, without trusting anything else in the token. */
export function readKid(token: string): string | null {
  const header = token.split(".")[0];
  if (!header) return null;
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { kid?: unknown };
    return typeof parsed.kid === "string" ? parsed.kid : null;
  } catch {
    return null;
  }
}

/**
 * Narrow verified claims to the three things we use.
 *
 * `email_verified` arrives as a boolean from Google and as either a boolean or
 * the string "true" from Apple, which is the kind of difference that turns
 * into an account-linking hole when it is read with a bare truthiness check —
 * the string "false" is truthy.
 */
export function toProfile(claims: Record<string, unknown>): OAuthProfile | null {
  const subject = typeof claims.sub === "string" ? claims.sub : null;
  const email = typeof claims.email === "string" ? claims.email.toLowerCase().trim() : null;
  if (!subject || !email) return null;

  const raw = claims.email_verified;
  const emailVerified = raw === true || raw === "true";

  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null;
  return { subject, email, emailVerified, name };
}
