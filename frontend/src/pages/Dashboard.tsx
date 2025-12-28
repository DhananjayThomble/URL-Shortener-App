import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { LinkShortener, RecentLinks } from "@/components/dashboard/LinkShortener";
import { ClicksChart, TopLinksChart } from "@/components/dashboard/AnalyticsCharts";
import { BioPageEditor } from "@/components/dashboard/BioPageEditor";
import { TagsManager } from "@/components/dashboard/TagsManager";
import { BulkImportExport } from "@/components/dashboard/BulkImportExport";
import { SettingsPage } from "@/components/dashboard/SettingsPage";
import { ApiPage } from "@/components/dashboard/ApiPage";
import { Bell, Search, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";

const Dashboard = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const userInitial = user.email?.charAt(0).toUpperCase() || "U";

  // Determine which section to show based on route
  const currentPath = location.pathname;
  
  const renderContent = () => {
    switch (currentPath) {
      case "/dashboard/bio":
        return (
          <div className="max-w-2xl">
            <BioPageEditor />
          </div>
        );
      case "/dashboard/tags":
        return (
          <div className="max-w-2xl">
            <TagsManager />
          </div>
        );
      case "/dashboard/bulk":
        return (
          <div className="max-w-2xl">
            <BulkImportExport />
          </div>
        );
      case "/dashboard/settings":
        return <SettingsPage />;
      case "/dashboard/api":
        return <ApiPage />;
      case "/dashboard/analytics":
        return (
          <>
            <StatsCards />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <ClicksChart />
              <TopLinksChart />
            </div>
          </>
        );
      case "/dashboard/links":
        return (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <LinkShortener />
            <RecentLinks />
          </div>
        );
      default:
        // Main dashboard view
        return (
          <>
            <StatsCards />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <LinkShortener />
              <RecentLinks />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <ClicksChart />
              <TopLinksChart />
            </div>
          </>
        );
    }
  };

  const getPageTitle = () => {
    switch (currentPath) {
      case "/dashboard/bio":
        return "Bio Page";
      case "/dashboard/tags":
        return "Tags";
      case "/dashboard/bulk":
        return "Import / Export";
      case "/dashboard/analytics":
        return "Analytics";
      case "/dashboard/links":
        return "Links";
      case "/dashboard/api":
        return "API";
      case "/dashboard/settings":
        return "Settings";
      default:
        return "Dashboard";
    }
  };

  return (
    <DashboardLayout>
      {/* Header */}
      <header className="sticky top-0 z-30 h-16 border-b border-border glass-strong">
        <div className="flex items-center justify-between h-full px-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-foreground">{getPageTitle()}</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search links..."
                variant="glass"
                className="w-64 pl-10"
              />
            </div>
            
            <ThemeToggle />

            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" />
            </Button>

            <Button variant="ghost" size="icon" onClick={handleSignOut}>
              <LogOut className="w-5 h-5" />
            </Button>
            
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-glow-secondary flex items-center justify-center text-primary-foreground font-semibold">
              {userInitial}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="p-6 space-y-6">
        {renderContent()}
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
