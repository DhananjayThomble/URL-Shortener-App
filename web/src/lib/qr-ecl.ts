import { QR_LOGO_MIN_ECL, effectiveEcl, type QrEcl } from "./qr-compose";

/* What the QR studio tells the user about error correction (#774).
   Pure, so the wording and the "your choice was raised" decision are unit-tested under
   Node instead of being buried in the page.

   Recovery figures are ISO/IEC 18004 §7.5.1 Table 12: L 7 %, M 15 %, Q 25 %, H 30 % of
   the symbol's codewords can be restored. */

export const QR_ECL_LEVELS: readonly QrEcl[] = ["L", "M", "Q", "H"];

const RECOVERY_PERCENT: Record<QrEcl, number> = { L: 7, M: 15, Q: 25, H: 30 };

const GUIDANCE: Record<QrEcl, string> = {
  L: "smallest, simplest code — for clean, on-screen use.",
  M: "a good balance for most print.",
  Q: "tolerates a centre logo and light print wear.",
  H: "densest code — for rough surfaces, small print or a lot of wear.",
};

export type EclHelp = {
  /** Describes the level the user picked. */
  text: string;
  /** Set when the centre logo makes the studio generate a higher level than the one picked. */
  notice: string | null;
  /** The level the code is really generated at. */
  effective: QrEcl;
  raised: boolean;
};

export function eclHelp(ecl: QrEcl, logo: boolean): EclHelp {
  const effective = effectiveEcl(ecl, logo);
  const raised = effective !== ecl;
  return {
    text: `${ecl} recovers about ${RECOVERY_PERCENT[ecl]}% damage — ${GUIDANCE[ecl]}`,
    notice: raised
      ? `The centre logo covers part of the code, so it needs at least ${QR_LOGO_MIN_ECL}. This code is generated at ${effective}. Turn the logo off to use ${ecl}.`
      : null,
    effective,
    raised,
  };
}
