"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { Breakdown, TimeseriesPoint } from "@/lib/api/types";
import { cn, compact, full } from "@/lib/utils";

/* ---------------- Sparkline ----------------
   Hand-rolled rather than Recharts: these render dozens per page in
   list rows, and a full chart runtime per row is wasted work. */
export function Sparkline({
  values,
  width = 96,
  height = 30,
  tone = "accent",
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "accent" | "muted";
}) {
  if (!values.length) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1 || 1);
  const points = values.map((v, i) => [i * step, height - 2 - ((v - min) / range) * (height - 5)] as const);
  const d = points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const stroke = tone === "muted" ? "var(--ink-3)" : "var(--accent)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block overflow-visible"
    >
      <path d={`${d} L ${width} ${height} L 0 ${height} Z`} fill="var(--accent-wash)" />
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r={2.2} fill={stroke} />
    </svg>
  );
}

/* ---------------- Area chart ---------------- */
type SeriesKey = "clicks" | "unique" | "scans";

export function TrafficChart({
  data,
  series = ["clicks", "unique"],
  height = 220,
}: {
  data: TimeseriesPoint[];
  series?: SeriesKey[];
  height?: number;
}) {
  // "Unique" carries the same "(approx.)" caveat as the KPI tiles: the figure
  // is a HyperLogLog estimate, not an exact distinct count, and the legend must
  // not imply otherwise.
  const labels: Record<SeriesKey, string> = { clicks: "Clicks", unique: "Unique (approx.)", scans: "QR scans" };
  // Primary series takes the brand accent; the comparison stays neutral so
  // the pairing survives whichever accent the viewer picked.
  const colors: Record<SeriesKey, string> = {
    clicks: "var(--accent)",
    unique: "var(--chart-2)",
    scans: "var(--chart-2)",
  };

  return (
    <div>
      <div className="flex gap-4 mb-3">
        {series.map((s) => (
          <span key={s} className="flex items-center gap-[6px] text-[11.5px] text-ink-3">
            <i className="w-[9px] h-[2.5px] rounded-[2px]" style={{ background: colors[s] }} />
            {labels[s]}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="fillPrimary" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--ink-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--line-2)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              boxShadow: "var(--shadow-2)",
              color: "var(--ink)",
            }}
            labelStyle={{ color: "var(--ink-3)", fontSize: 11 }}
            formatter={(value, name) => [full(Number(value ?? 0)), labels[String(name) as SeriesKey] ?? String(name)]}
          />
          {series.map((s, i) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stroke={colors[s]}
              strokeWidth={2}
              fill={i === 0 ? "url(#fillPrimary)" : "transparent"}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--surface)" }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- Ranked bar list ---------------- */
export function BarList({ rows, mono = false }: { rows: Breakdown[]; mono?: boolean }) {
  if (!rows.length) return <p className="text-[13px] text-ink-3 m-0">Nothing here yet.</p>;
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const top = Math.max(...rows.map((r) => r.value)) || 1;

  return (
    <div className="flex flex-col gap-[2px]">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-[11px] px-2 py-[7px] rounded-[var(--radius-sm)] relative group">
          <span
            className="absolute left-0 top-0 bottom-0 bg-accent-wash rounded-[var(--radius-sm)] transition-[width]"
            style={{ width: `${(r.value / top) * 100}%` }}
          />
          <span
            className={cn(
              "relative flex-1 min-w-0 text-[13px] truncate flex items-center gap-2",
              mono && "font-mono text-[12.5px]",
            )}
          >
            {r.icon ? <span className="text-[14px]">{r.icon}</span> : null}
            {r.label}
          </span>
          <span className="relative font-mono text-[12.5px] font-semibold tnum">{full(r.value)}</span>
          <span className="relative text-[11px] text-ink-3 font-mono w-[38px] text-right tnum">
            {((r.value / total) * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Funnel ---------------- */
export function Funnel({ steps }: { steps: { label: string; value: number; pct?: number }[] }) {
  const top = steps[0]?.value || 1;
  return (
    <div className="flex flex-col">
      {steps.map((s, i) => {
        const width = Math.max(8, (s.value / top) * 100);
        const prev = steps[i - 1];
        const drop = prev ? (1 - s.value / prev.value) * 100 : null;
        return (
          <div key={s.label}>
            {drop !== null ? (
              <div className="text-[11px] text-ink-3 pl-[13px] font-mono py-[2px]">▼ {drop.toFixed(1)}% drop off</div>
            ) : null}
            <div className="relative py-[11px]">
              <div
                className="h-9 bg-accent rounded-[var(--radius-sm)]"
                style={{ width: `${width}%`, opacity: 1 - i * 0.16 }}
              />
              <div className="absolute inset-x-0 top-[11px] h-9 flex items-center justify-between px-[13px] text-[12.5px] font-semibold text-accent-ink">
                <span>{s.label}</span>
                <span className="tnum opacity-85">
                  {compact(s.value)}
                  {s.pct !== undefined ? ` · ${s.pct.toFixed(1)}%` : ""}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
