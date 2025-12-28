import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useState, useEffect } from "react";
import { analyticsService } from "@/services/analytics.service";
import { useRealTimeAnalytics } from "@/hooks/useRealTimeAnalytics";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass rounded-lg p-3 border border-border">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold text-foreground">
          {payload[0].value.toLocaleString()} clicks
        </p>
      </div>
    );
  }
  return null;
};

export const ClicksChart = () => {
  const { dailyClicks, loading } = useAnalytics();
  const { realTimeData, isConnected } = useRealTimeAnalytics({ enabled: true });
  const [chartData, setChartData] = useState<any[]>([]);

  // Update chart data with real-time information
  useEffect(() => {
    const baseData = dailyClicks.map((item) => ({
      name: format(new Date(item.date), "EEE"),
      clicks: item.clicks,
      date: item.date,
    }));

    // Add real-time data for today if available
    if (realTimeData && realTimeData.recentClicks.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const todayIndex = baseData.findIndex(item => item.date === today);
      
      if (todayIndex >= 0) {
        // Add recent clicks to today's count
        const recentClicksCount = realTimeData.recentClicks.length;
        baseData[todayIndex] = {
          ...baseData[todayIndex],
          clicks: baseData[todayIndex].clicks + recentClicksCount,
        };
      }
    }

    setChartData(baseData);
  }, [dailyClicks, realTimeData]);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl glass gradient-border p-6"
      >
        <div className="flex items-center justify-center h-[360px]">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="rounded-2xl glass gradient-border p-6"
    >
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Click Analytics</h2>
            <p className="text-sm text-muted-foreground">Clicks over the last 7 days</p>
          </div>
          {realTimeData && (
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
              <span className="text-xs text-muted-foreground">
                {isConnected ? 'Live Updates' : 'Disconnected'}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="h-[300px]">
        {chartData.length === 0 || chartData.every((d) => d.clicks === 0) ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No click data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="clicksGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
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
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="clicks"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#clicksGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </motion.div>
  );
};

export const TopLinksChart = () => {
  const [topLinks, setTopLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTopLinks = async () => {
      try {
        setLoading(true);
        const data = await analyticsService.getTopURLsData(5);
        if (data) {
          setTopLinks(data);
        }
      } catch (error) {
        console.error('Error fetching top links:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTopLinks();
  }, []);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="rounded-2xl glass gradient-border p-6"
      >
        <div className="flex items-center justify-center h-[360px]">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="rounded-2xl glass gradient-border p-6"
    >
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-foreground">Top Performing Links</h2>
        <p className="text-sm text-muted-foreground">Your most clicked links</p>
      </div>

      <div className="h-[300px]">
        {topLinks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No links yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topLinks} layout="vertical">
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={1} />
                  <stop offset="100%" stopColor="hsl(262 83% 58%)" stopOpacity={1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis 
                type="number"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                type="category"
                dataKey="name"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={110}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar 
                dataKey="clicks" 
                fill="url(#barGradient)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </motion.div>
  );
};
