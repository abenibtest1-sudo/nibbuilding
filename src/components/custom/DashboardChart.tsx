"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

interface ChartDataPoint {
  name: string;
  revenue: number;
  expenses: number;
}

interface DashboardChartProps {
  data: ChartDataPoint[];
}

export function DashboardChart({ data }: DashboardChartProps) {
  const formatYAxisTick = (value: number): string => {
    if (value === 0) return "0";
    if (value >= 1000) {
      return `${(value / 1000).toFixed(value % 1000 !== 0 ? 1 : 0)}k`;
    }
    return value.toString();
  };

  return (
    <div className="h-full w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="name"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatYAxisTick}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--accent)/0.3)" }}
            contentStyle={{
              backgroundColor: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-md)",
            }}
            labelStyle={{
              color: "hsl(var(--foreground))",
              fontWeight: "bold",
              marginBottom: "4px",
            }}
            formatter={(value: number, name: string) => {
              const formattedValue = `${value.toLocaleString()} Birr`;
              const nameCapitalized =
                name.charAt(0).toUpperCase() + name.slice(1);
              return [formattedValue, nameCapitalized];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }}
            iconType="circle"
            iconSize={8}
          />
          <Bar
            dataKey="revenue"
            fill="hsl(var(--primary))"
            radius={[4, 4, 0, 0]}
            name="Revenue"
            barSize={30}
          />
          <Bar
            dataKey="expenses"
            fill="hsl(var(--accent))"
            radius={[4, 4, 0, 0]}
            name="Expenses"
            barSize={30}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
