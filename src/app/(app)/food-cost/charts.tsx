"use client";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
export default function Chart({
  title,
  data,
  line = false,
}: {
  title: string;
  data: { name: string; value: number }[];
  line?: boolean;
}) {
  return (
    <section className="card food-chart">
      <h3>{title}</h3>
      {!data.length ? (
        <p>Zatiaľ nie sú potvrdené údaje.</p>
      ) : (
        <ResponsiveContainer
          width="100%"
          height={260}
          initialDimension={{ width: 300, height: 260 }}
        >
          {line ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis width={50} />
              <Tooltip formatter={(v) => `${Number(v).toFixed(2)} Kč`} />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="value"
                stroke="#276b50"
                strokeWidth={3}
              />
            </LineChart>
          ) : (
            <BarChart data={data}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis width={50} />
              <Tooltip formatter={(v) => `${Number(v).toFixed(2)} Kč`} />
              <Bar
                isAnimationActive={false}
                dataKey="value"
                fill="#276b50"
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </section>
  );
}
