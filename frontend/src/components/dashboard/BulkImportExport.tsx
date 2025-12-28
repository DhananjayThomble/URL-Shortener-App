import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Download, FileSpreadsheet, Loader2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { useLinks } from "@/hooks/useLinks";
import Papa from "papaparse";

export const BulkImportExport = () => {
  const { links, createLink } = useLinks();
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const exportData = links.map((link) => ({
      original_url: link.original_url,
      short_code: link.short_code,
      custom_alias: link.custom_alias || "",
      ios_url: link.ios_url || "",
      android_url: link.android_url || "",
      utm_source: link.utm_source || "",
      utm_medium: link.utm_medium || "",
      utm_campaign: link.utm_campaign || "",
      clicks: link.clicks_count,
      created_at: link.created_at,
    }));

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `snapurl-links-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Links exported successfully!");
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);

    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        const urls = results.data as Array<{
          original_url?: string;
          url?: string;
          ios_url?: string;
          android_url?: string;
          utm_source?: string;
          utm_medium?: string;
          utm_campaign?: string;
        }>;

        const validUrls = urls.filter((row) => row.original_url || row.url);
        setImportProgress({ current: 0, total: validUrls.length });

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < validUrls.length; i++) {
          const row = validUrls[i];
          const url = row.original_url || row.url;
          
          if (url) {
            try {
              new URL(url);
              const result = await createLink({
                originalUrl: url,
                iosUrl: row.ios_url,
                androidUrl: row.android_url,
                utmSource: row.utm_source,
                utmMedium: row.utm_medium,
                utmCampaign: row.utm_campaign,
              });
              
              if (result) {
                successCount++;
              } else {
                errorCount++;
              }
            } catch {
              errorCount++;
            }
          }
          
          setImportProgress({ current: i + 1, total: validUrls.length });
        }

        setImporting(false);
        setImportProgress({ current: 0, total: 0 });
        
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }

        toast.success(
          `Import complete: ${successCount} links created${errorCount > 0 ? `, ${errorCount} failed` : ""}`
        );
      },
      error: (error) => {
        console.error("CSV parsing error:", error);
        toast.error("Failed to parse CSV file");
        setImporting(false);
      },
    });
  };

  const downloadTemplate = () => {
    const template = [
      {
        original_url: "https://example.com/page1",
        ios_url: "https://apps.apple.com/app/example",
        android_url: "https://play.google.com/store/apps/example",
        utm_source: "twitter",
        utm_medium: "social",
        utm_campaign: "summer2024",
      },
      {
        original_url: "https://example.com/page2",
        ios_url: "",
        android_url: "",
        utm_source: "",
        utm_medium: "",
        utm_campaign: "",
      },
    ];

    const csv = Papa.unparse(template);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "snapurl-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Template downloaded!");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl glass gradient-border p-6"
    >
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-foreground">Bulk Import/Export</h2>
        <p className="text-sm text-muted-foreground">Manage your links in bulk via CSV</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Import */}
        <div className="p-4 rounded-xl glass space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Upload className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-medium text-foreground">Import Links</h3>
              <p className="text-xs text-muted-foreground">Upload a CSV file</p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleImport}
            className="hidden"
            id="csv-import"
          />

          {importing ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Importing...</span>
                <span className="text-foreground">
                  {importProgress.current} / {importProgress.total}
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all"
                  style={{ 
                    width: `${(importProgress.current / importProgress.total) * 100}%` 
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => document.getElementById("csv-import")?.click()}
                className="flex-1"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload CSV
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={downloadTemplate}
              >
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Template
              </Button>
            </div>
          )}
        </div>

        {/* Export */}
        <div className="p-4 rounded-xl glass space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-glow-secondary/10 flex items-center justify-center">
              <Download className="w-5 h-5 text-glow-secondary" />
            </div>
            <div>
              <h3 className="font-medium text-foreground">Export Links</h3>
              <p className="text-xs text-muted-foreground">Download all your links</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total links:</span>
            <span className="text-foreground font-medium">{links.length}</span>
          </div>

          <Button 
            variant="outline" 
            size="sm"
            onClick={handleExport}
            disabled={links.length === 0}
            className="w-full"
          >
            <Download className="w-4 h-4 mr-2" />
            Export to CSV
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
