"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { day: string; value: number };

function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

/**
 * Single-series daily bar chart (one series → title names it, no legend). Thin bars with
 * rounded data-ends, recessive grid, hover tooltip, and a screen-reader table equivalent.
 */
export function DailyBarChart({
  title,
  data,
  color,
  unit,
}: {
  title: string;
  data: Point[];
  color: string;
  unit: string;
}) {
  const total = data.reduce((s, p) => s + p.value, 0);
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="text-muted-foreground tabular text-xs">
          {total.toLocaleString()} in 14 days
        </span>
      </figcaption>
      <div className="mt-3 h-40" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
            <XAxis
              dataKey="day"
              tickFormatter={shortDay}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              width={48}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              formatter={(value) => [`${value} ${unit}`, ""]}
              labelFormatter={(label) => shortDay(String(label))}
              separator=""
              contentStyle={{
                borderRadius: 6,
                border: "1px solid var(--border)",
                fontSize: 12,
                color: "var(--foreground)",
                boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
              }}
            />
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{title} per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">{unit}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.day}>
              <td>{p.day}</td>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
