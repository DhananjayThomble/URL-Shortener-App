import { motion } from "framer-motion";
import { 
  Target, 
  Globe2, 
  Timer, 
  BarChart3, 
  Smartphone, 
  QrCode,
  Layers,
  Webhook
} from "lucide-react";

const features = [
  {
    icon: Target,
    title: "Smart Routing",
    description: "Route users based on device, location, or time. Perfect for app store links and geo-targeted campaigns.",
    gradient: "from-primary to-cyan-400",
  },
  {
    icon: Globe2,
    title: "Geo-Targeting",
    description: "Redirect visitors to country-specific pages automatically. Personalize every click.",
    gradient: "from-violet-500 to-purple-600",
  },
  {
    icon: Timer,
    title: "Time-Based Links",
    description: "Schedule link activation and expiry. Perfect for flash sales and limited-time offers.",
    gradient: "from-orange-500 to-red-500",
  },
  {
    icon: BarChart3,
    title: "Deep Analytics",
    description: "Real-time click tracking, referrer analysis, and interactive heatmaps. Know your audience.",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    icon: Smartphone,
    title: "Device Detection",
    description: "Send iOS users to App Store, Android to Play Store, and desktop to web—automatically.",
    gradient: "from-pink-500 to-rose-500",
  },
  {
    icon: QrCode,
    title: "Dynamic QR Codes",
    description: "Generate branded QR codes that track scans. Update destinations without reprinting.",
    gradient: "from-blue-500 to-indigo-500",
  },
  {
    icon: Layers,
    title: "Link-in-Bio",
    description: "Create stunning bio pages with analytics. Embed videos, music, and collect emails.",
    gradient: "from-amber-500 to-yellow-500",
  },
  {
    icon: Webhook,
    title: "Developer API",
    description: "RESTful API with webhooks, rate limiting, and comprehensive documentation.",
    gradient: "from-slate-500 to-zinc-500",
  },
];

export const FeaturesSection = () => {
  return (
    <section id="features" className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-surface-elevated/30 to-background" />
      <div className="absolute inset-0 dot-pattern opacity-20" />

      <div className="relative container mx-auto px-6">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-20">
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-block px-4 py-1.5 rounded-full glass text-sm text-primary font-medium mb-6"
          >
            Features
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6"
          >
            Everything you need to{" "}
            <span className="gradient-text">orchestrate</span> your links
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-lg text-muted-foreground"
          >
            From basic shortening to advanced routing, retargeting, and analytics.
            Built for scale, designed for everyone.
          </motion.p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.05 }}
              className="group relative"
            >
              <div className="relative h-full p-6 rounded-2xl glass gradient-border overflow-hidden transition-all duration-300 hover:scale-[1.02]">
                {/* Gradient glow on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />
                
                {/* Icon */}
                <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${feature.gradient} mb-4`}>
                  <feature.icon className="w-6 h-6 text-white" />
                </div>

                {/* Content */}
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
