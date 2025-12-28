import { 
  Link2, 
  MousePointerClick, 
  TrendingUp,
  Loader2,
  Users,
  Target
} from "lucide-react";
import { motion } from "framer-motion";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useRealTimeAnalytics } from "@/hooks/useRealTimeAnalytics";
import { useEffect, useState } from "react";

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ElementType;
  gradient: string;
}

const StatCard = ({ title, value, icon: Icon, gradient }: StatCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative rounded-2xl glass gradient-border p-6 overflow-hidden"
    >
      {/* Background gradient */}
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-5`} />
      
      <div className="relative">
        <div className="flex items-start justify-between mb-4">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${gradient}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>
        
        <h3 className="text-sm text-muted-foreground mb-1">{title}</h3>
        <p className="text-3xl font-bold text-foreground">{value}</p>
      </div>
    </motion.div>
  );
};

export const StatsCards = () => {
  const { stats, loading } = useAnalytics();
  const { realTimeData, isConnected } = useRealTimeAnalytics({ enabled: true });
  const [realTimeStats, setRealTimeStats] = useState(stats);

  // Update stats with real-time data when available
  useEffect(() => {
    if (realTimeData && stats) {
      setRealTimeStats({
        ...stats,
        // Add real-time active visitors if available
        activeVisitors: realTimeData.activeVisitors,
      });
    } else {
      setRealTimeStats(stats);
    }
  }, [stats, realTimeData]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl glass gradient-border p-6 h-32 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Links",
      value: realTimeStats.totalLinks.toLocaleString(),
      icon: Link2,
      gradient: "from-primary to-cyan-400",
    },
    {
      title: "Total Clicks",
      value: realTimeStats.totalClicks.toLocaleString(),
      icon: MousePointerClick,
      gradient: "from-violet-500 to-purple-600",
    },
    {
      title: "Active Links",
      value: realTimeStats.activeLinks.toLocaleString(),
      icon: TrendingUp,
      gradient: "from-emerald-500 to-teal-500",
    },
    {
      title: realTimeData ? "Active Visitors" : "Avg. Clicks/Link",
      value: realTimeData 
        ? realTimeStats.activeVisitors?.toLocaleString() || "0"
        : realTimeStats.avgClicksPerLink.toLocaleString(),
      icon: realTimeData ? Users : Target,
      gradient: "from-orange-500 to-red-500",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {statCards.map((stat, index) => (
        <motion.div
          key={stat.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
        >
          <StatCard {...stat} />
          {/* Real-time indicator */}
          {realTimeData && index === 3 && (
            <div className="flex items-center justify-center mt-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
              <span className="text-xs text-muted-foreground ml-2">
                {isConnected ? 'Live' : 'Disconnected'}
              </span>
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
};
