import type { Domain } from "@snapurl/contract";
import { domainOptionLabel, isUsableForLinks } from "./domain-choice";

/* #779 — Settings > Default domain is a select, not free text. The API now
   refuses (400) a default that is not a live domain of this workspace (or the
   shared one), so the control only offers what would be accepted. The pure
   decisions live here because web tests run in Node, without a DOM. */

export type DefaultDomainOption = { value: string; label: string; disabled: boolean };

const PLACEHOLDER: DefaultDomainOption = { value: "", label: "Choose a domain", disabled: true };

/**
 * The options for the Default domain select: every live domain, in list order.
 *
 * The CURRENT default is always shown so the select never displays a value the
 * workspace does not have — if it has stopped being live (or the list has not
 * loaded yet) it appears disabled and, when we know why, says so. It cannot be
 * re-picked once left, which is the point: it is not a valid choice any more.
 * A workspace with no default yet gets a disabled "Choose a domain" first.
 */
export function defaultDomainOptions(
  domains: readonly Domain[] | undefined,
  current: string,
): DefaultDomainOption[] {
  const list = domains ?? [];
  const wanted = current.toLowerCase();

  const options: DefaultDomainOption[] = list
    .filter((d) => isUsableForLinks(d) || d.domain.toLowerCase() === wanted)
    .map((d) => ({ value: d.domain, label: domainOptionLabel(d), disabled: !isUsableForLinks(d) }));

  if (!current) return [PLACEHOLDER, ...options];
  if (!options.some((o) => o.value.toLowerCase() === wanted)) {
    options.unshift({ value: current, label: current, disabled: true });
  }
  return options;
}

export type ProblemField = "defaultDomain" | "currency" | "other";

/**
 * Which field a refused Save is reported under. The form saves as one PATCH, so
 * the error is about whichever control the person changed; when they changed
 * both the domain and the currency, the message says which (the API's domain
 * messages all name "domain" or the domain itself).
 */
export function problemField(
  message: string,
  changed: { defaultDomain: boolean; currency: boolean },
): ProblemField {
  if (changed.defaultDomain && !changed.currency) return "defaultDomain";
  if (changed.currency && !changed.defaultDomain) return "currency";
  if (changed.defaultDomain && changed.currency) {
    return /domain|verified yet/i.test(message) ? "defaultDomain" : "currency";
  }
  return "other";
}
