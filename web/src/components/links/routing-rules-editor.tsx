"use client";

import { Button, Chip, Input } from "@/components/ui";
import type { DeviceType, RoutingRule } from "@snapurl/contract";
import { validateRoutingChain } from "@snapurl/domain/routing";
import { cn } from "@/lib/utils";

/* ============================================================
   The routing chain editor.

   The drawer used to render four hardcoded rows from a presentational-only
   component — country IN, iOS, Android, and a 50/50 split — with an add button
   that had no handler. None of it was ever submitted: `rules` went to the API
   as an empty array every time, so the headline feature on the landing page
   ("Route by anything") produced links that routed by nothing.

   Everything behind it was already built: validateRoutingChain and
   evaluateRouting in packages/domain, persisted by LinksService.create and
   executed by apps/redirect. This is the missing input surface.
   ============================================================ */

/** The four conditions a rule can carry. "Everything else" is the catch-all. */
type ConditionKind = "any" | "country" | "device" | "language";

const CONDITIONS: { value: ConditionKind; label: string }[] = [
  { value: "any", label: "Everything else" },
  { value: "country", label: "Country is" },
  { value: "device", label: "Device is" },
  { value: "language", label: "Language is" },
];

const DEVICES: DeviceType[] = ["ios", "android", "desktop", "mobile"];

const SELECT_CLASS =
  "px-[9px] py-[6px] bg-surface border border-line-2 rounded-[var(--radius-sm)] text-[12.5px] text-ink-2";

function kindOf(rule: RoutingRule): ConditionKind {
  if (rule.when.country) return "country";
  if (rule.when.device) return "device";
  if (rule.when.language) return "language";
  return "any";
}

const isCatchAll = (rule: RoutingRule) => kindOf(rule) === "any";

/** Rules are identified by id in the contract and by nothing else here. */
function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `rule_${crypto.randomUUID().slice(0, 8)}`
    : `rule_${Math.random().toString(36).slice(2, 10)}`;
}

export function RoutingRulesEditor({
  value,
  onChange,
  fallbackDestination,
}: {
  value: RoutingRule[];
  onChange: (rules: RoutingRule[]) => void;
  /** Where a visitor lands when nothing matches — the link's own destination. */
  fallbackDestination: string;
}) {
  const rules = value ?? [];

  /* The same function the API validates with on save, so the feedback here is
     the feedback there. Duplicating the rules in the browser is exactly the
     drift this project already removed once. */
  const problems = validateRoutingChain(rules);

  const replace = (index: number, next: RoutingRule) =>
    onChange(rules.map((rule, i) => (i === index ? next : rule)));

  const setKind = (index: number, kind: ConditionKind) => {
    const rule = rules[index]!;
    // Only one condition at a time: a rule matching country AND device is
    // expressible in the contract but not something this UI should invent.
    const when = { country: null, device: null, language: null } as RoutingRule["when"];
    if (kind === "country") when.country = "IN";
    if (kind === "device") when.device = "ios";
    if (kind === "language") when.language = "en";
    // Weight only means anything on a catch-all, so drop it when conditions appear.
    replace(index, { ...rule, when, weight: kind === "any" ? rule.weight : null });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  const add = (weighted = false) =>
    onChange([
      ...rules,
      {
        id: newId(),
        when: { country: null, device: null, language: null },
        then: "",
        weight: weighted ? 50 : null,
      },
    ]);

  /** Two weighted catch-alls at 50/50 is the shape an A/B test actually needs. */
  const startSplit = () =>
    onChange([
      ...rules,
      { id: newId(), when: { country: null, device: null, language: null }, then: "", weight: 50 },
      { id: newId(), when: { country: null, device: null, language: null }, then: "", weight: 50 },
    ]);

  const weightedCount = rules.filter((r) => isCatchAll(r) && (r.weight ?? 0) > 0).length;

  return (
    <div className="flex flex-col gap-[9px]">
      {rules.length === 0 ? (
        <div className="px-3 py-3 border border-dashed border-line-2 rounded-[var(--radius-sm)] text-[12px] text-ink-3 leading-[1.55]">
          No rules yet — every visitor goes to{" "}
          <span className="font-mono text-teal">{fallbackDestination || "your destination"}</span>. Add a rule to send
          some of them somewhere else.
        </div>
      ) : null}

      {rules.map((rule, i) => {
        const kind = kindOf(rule);
        return (
          <div
            key={rule.id}
            className={cn(
              "flex flex-col gap-2 px-3 py-[10px] rounded-[var(--radius-sm)] border",
              isCatchAll(rule) ? "border-dashed border-line-2" : "border-line bg-surface",
            )}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] text-ink-3 w-[16px] shrink-0">{i + 1}</span>

              <select
                className={SELECT_CLASS}
                value={kind}
                onChange={(e) => setKind(i, e.target.value as ConditionKind)}
                aria-label={`Rule ${i + 1} condition`}
              >
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>

              {kind === "country" ? (
                <Input
                  value={rule.when.country ?? ""}
                  onChange={(e) =>
                    replace(i, { ...rule, when: { ...rule.when, country: e.target.value.toUpperCase().slice(0, 2) } })
                  }
                  placeholder="IN"
                  aria-label={`Rule ${i + 1} country`}
                  className="w-[70px] font-mono text-[12.5px] uppercase"
                />
              ) : null}

              {kind === "device" ? (
                <select
                  className={SELECT_CLASS}
                  value={rule.when.device ?? "ios"}
                  onChange={(e) => replace(i, { ...rule, when: { ...rule.when, device: e.target.value as DeviceType } })}
                  aria-label={`Rule ${i + 1} device`}
                >
                  {DEVICES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : null}

              {kind === "language" ? (
                <Input
                  value={rule.when.language ?? ""}
                  onChange={(e) =>
                    replace(i, { ...rule, when: { ...rule.when, language: e.target.value.toLowerCase().slice(0, 5) } })
                  }
                  placeholder="en"
                  aria-label={`Rule ${i + 1} language`}
                  className="w-[70px] font-mono text-[12.5px]"
                />
              ) : null}

              {isCatchAll(rule) && (rule.weight ?? 0) > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={rule.weight ?? 0}
                    onChange={(e) => replace(i, { ...rule, weight: Number(e.target.value) })}
                    aria-label={`Rule ${i + 1} weight`}
                    className="w-[64px] font-mono text-[12.5px] tnum"
                  />
                  <span className="text-[12px] text-ink-3">%</span>
                </span>
              ) : null}

              <div className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Move rule ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Move rule ${i + 1} down`}
                  disabled={i === rules.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove rule ${i + 1}`}
                  onClick={() => onChange(rules.filter((_, j) => j !== i))}
                >
                  ✕
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[12px] text-ink-3 shrink-0">go to</span>
              <Input
                value={rule.then}
                onChange={(e) => replace(i, { ...rule, then: e.target.value })}
                placeholder="https://example.com/somewhere-else"
                aria-label={`Rule ${i + 1} destination`}
                className="font-mono text-[12px]"
              />
            </div>
          </div>
        );
      })}

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => add()}
          className="px-3 py-2 border border-dashed border-line-2 rounded-[var(--radius-sm)] text-ink-3 text-[12px] hover:border-accent hover:text-accent"
        >
          ＋ Add rule
        </button>
        {weightedCount === 0 ? (
          <button
            type="button"
            onClick={startSplit}
            className="px-3 py-2 border border-dashed border-line-2 rounded-[var(--radius-sm)] text-ink-3 text-[12px] hover:border-accent hover:text-accent"
          >
            ＋ Add 50/50 split test
          </button>
        ) : (
          <button
            type="button"
            onClick={() => add(true)}
            className="px-3 py-2 border border-dashed border-line-2 rounded-[var(--radius-sm)] text-ink-3 text-[12px] hover:border-accent hover:text-accent"
          >
            ＋ Add split arm
          </button>
        )}
        {weightedCount > 1 ? <Chip tone="accent">A/B across {weightedCount} arms</Chip> : null}
      </div>

      {problems.length > 0 ? (
        /* Shown as you type rather than on submit. The API rejects the same
           chain with the same sentences, so this is a preview of that refusal,
           not a second opinion about it. */
        <div className="px-[11px] py-[9px] bg-wash-warn rounded-[var(--radius-sm)] flex flex-col gap-1">
          {problems.map((problem) => (
            <span key={problem} className="text-[12px] text-amber leading-[1.5]">
              {problem}
            </span>
          ))}
        </div>
      ) : null}

      {rules.length > 0 && problems.length === 0 ? (
        <span className="text-[11.5px] text-ink-3 leading-[1.5]">
          Checked top to bottom at the edge. Anything matching nothing falls through to{" "}
          <span className="font-mono text-teal">{fallbackDestination || "your destination"}</span>.
        </span>
      ) : null}
    </div>
  );
}
