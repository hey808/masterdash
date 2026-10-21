"use client";

import type { Bucket } from "@/lib/reports";
import BarChart from "./charts/BarChart";

const SOLD = "#087dfc";
const OUT = "#eb6834";
const short = (c: number) => {
  const d = c / 100;
  if (d === 0) return "$0";
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(d) >= 1000) return `$${Math.round(d / 1000)}k`;
  return `$${Math.round(d)}`;
};
const full = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type Size = "day" | "week" | "month";

export default function HomeCharts({ buckets, size, cashBuckets, cashSize, pipeline }: {
  buckets: Bucket[];
  size: Size;
  cashBuckets: Bucket[];
  cashSize: Size;
  pipeline: Array<{ stage: string; label: string; deals: number; cents: number }>;
}) {
  const labels = buckets.map((b) => b.label);
  const per = size;
  const topPipe = Math.max(1, ...pipeline.map((p) => p.cents));
  return (
    <div className="home-charts">
      <section className="chart-card">
        <BarChart
          title={`Sold per ${per}`}
          labels={labels}
          series={[{ name: "Sold", color: SOLD, values: buckets.map((b) => b.soldCents) }]}
          format={short}
          detail={(i) => `${buckets[i]!.soldDeals} deal${buckets[i]!.soldDeals === 1 ? "" : "s"} · ${full(buckets[i]!.soldCents)}`}
        />
      </section>
      <section className="chart-card">
        <BarChart
          title={`Cash in vs expenses per ${cashSize}`}
          labels={cashBuckets.map((b) => (cashSize === "week" ? `Wk ${b.label}` : b.label))}
          series={[
            { name: "Collected", color: SOLD, values: cashBuckets.map((b) => b.collectedCents) },
            { name: "Expenses", color: OUT, values: cashBuckets.map((b) => b.expensesCents) },
          ]}
          format={short}
          detail={(i) => {
            const net = cashBuckets[i]!.collectedCents - cashBuckets[i]!.expensesCents;
            return `Net ${net < 0 ? "−" : ""}${full(Math.abs(net))}`;
          }}
        />
      </section>
      <section className="chart-card">
        <figure className="chart">
          <figcaption className="chart-head"><span className="chart-title">Open deals by stage</span><span className="muted small">today</span></figcaption>
          <ul className="hbars">
            {pipeline.map((p) => (
              <li key={p.stage}>
                <a href={`/ledger`} className="hbar-row" title={`${p.deals} deals · ${full(p.cents)}`}>
                  <span className="hbar-label"><span className={`stage ${p.stage}`}>{p.label}</span><span className="hbar-n">{p.deals} deal{p.deals === 1 ? "" : "s"}</span></span>
                  <span className="hbar-track"><span className="hbar-fill" style={{ width: `${Math.max(p.cents ? 2 : 0, (p.cents / topPipe) * 100)}%` }} /></span>
                  <span className="hbar-val">{full(p.cents)}</span>
                </a>
              </li>
            ))}
          </ul>
        </figure>
      </section>
    </div>
  );
}
