import * as XLSX from 'xlsx';
import type { AnalyticsData, ClicksByDate, CountryData, DeviceData, ReferrerData } from '@/types/analytics';

export type ExportFormat = 'csv' | 'excel' | 'pdf' | 'json';

export interface ExportOptions {
  format: ExportFormat;
  filename?: string;
  includeCharts?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

/**
 * Export analytics data to various formats
 */
export class AnalyticsExporter {
  /**
   * Export analytics data in the specified format
   */
  static async exportData(data: AnalyticsData, options: ExportOptions): Promise<void> {
    const filename = options.filename || `analytics-${new Date().toISOString().split('T')[0]}`;
    
    switch (options.format) {
      case 'csv':
        await this.exportToCSV(data, filename);
        break;
      case 'excel':
        await this.exportToExcel(data, filename);
        break;
      case 'pdf':
        await this.exportToPDF(data, filename, options.includeCharts);
        break;
      case 'json':
        await this.exportToJSON(data, filename);
        break;
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  }

  /**
   * Export to CSV format
   */
  private static async exportToCSV(data: AnalyticsData, filename: string): Promise<void> {
    const csvContent = this.generateCSVContent(data);
    this.downloadFile(csvContent, `${filename}.csv`, 'text/csv');
  }

  /**
   * Export to Excel format using xlsx library
   */
  private static async exportToExcel(data: AnalyticsData, filename: string): Promise<void> {
    const workbook = XLSX.utils.book_new();

    // Summary sheet
    const summaryData = [
      ['Metric', 'Value'],
      ['Total Clicks', data.totalClicks],
      ['Unique Clicks', data.uniqueClicks],
      ['Click-Through Rate', `${((data.uniqueClicks / data.totalClicks) * 100).toFixed(2)}%`],
      ['Export Date', new Date().toLocaleDateString()],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // Clicks by date sheet
    const clicksData = [
      ['Date', 'Total Clicks', 'Unique Clicks'],
      ...data.clicksByDate.map(item => [
        new Date(item.date).toLocaleDateString(),
        item.clicks,
        item.uniqueClicks
      ])
    ];
    const clicksSheet = XLSX.utils.aoa_to_sheet(clicksData);
    XLSX.utils.book_append_sheet(workbook, clicksSheet, 'Clicks by Date');

    // Countries sheet
    const countriesData = [
      ['Country', 'Country Code', 'Clicks', 'Percentage'],
      ...data.topCountries.map(item => [
        item.country,
        item.countryCode,
        item.clicks,
        `${item.percentage.toFixed(2)}%`
      ])
    ];
    const countriesSheet = XLSX.utils.aoa_to_sheet(countriesData);
    XLSX.utils.book_append_sheet(workbook, countriesSheet, 'Countries');

    // Devices sheet
    const devicesData = [
      ['Device', 'Clicks', 'Percentage'],
      ...data.topDevices.map(item => [
        item.device,
        item.clicks,
        `${item.percentage.toFixed(2)}%`
      ])
    ];
    const devicesSheet = XLSX.utils.aoa_to_sheet(devicesData);
    XLSX.utils.book_append_sheet(workbook, devicesSheet, 'Devices');

    // Browsers sheet
    const browsersData = [
      ['Browser', 'Version', 'Clicks', 'Percentage'],
      ...data.topBrowsers.map(item => [
        item.browser,
        item.version || 'N/A',
        item.clicks,
        `${item.percentage.toFixed(2)}%`
      ])
    ];
    const browsersSheet = XLSX.utils.aoa_to_sheet(browsersData);
    XLSX.utils.book_append_sheet(workbook, browsersSheet, 'Browsers');

    // Referrers sheet
    const referrersData = [
      ['Referrer', 'Domain', 'Clicks', 'Percentage'],
      ...data.topReferrers.map(item => [
        item.referrer,
        item.domain,
        item.clicks,
        `${item.percentage.toFixed(2)}%`
      ])
    ];
    const referrersSheet = XLSX.utils.aoa_to_sheet(referrersData);
    XLSX.utils.book_append_sheet(workbook, referrersSheet, 'Referrers');

    // Generate Excel file and download
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  }

  /**
   * Export to PDF format
   */
  private static async exportToPDF(data: AnalyticsData, filename: string, includeCharts = false): Promise<void> {
    const pdfContent = this.generatePDFContent(data, includeCharts);
    
    // Create a simple HTML-based PDF export
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(pdfContent);
      printWindow.document.close();
      printWindow.print();
    }
  }

  /**
   * Export to JSON format
   */
  private static async exportToJSON(data: AnalyticsData, filename: string): Promise<void> {
    const jsonContent = JSON.stringify(data, null, 2);
    this.downloadFile(jsonContent, `${filename}.json`, 'application/json');
  }

  /**
   * Generate CSV content from analytics data
   */
  private static generateCSVContent(data: AnalyticsData): string {
    const sections: string[] = [];

    // Summary section
    sections.push('ANALYTICS SUMMARY');
    sections.push('Metric,Value');
    sections.push(`Total Clicks,${data.totalClicks}`);
    sections.push(`Unique Clicks,${data.uniqueClicks}`);
    sections.push(`Click-Through Rate,${((data.uniqueClicks / data.totalClicks) * 100).toFixed(2)}%`);
    sections.push('');

    // Clicks by date
    sections.push('CLICKS BY DATE');
    sections.push('Date,Total Clicks,Unique Clicks');
    data.clicksByDate.forEach(item => {
      sections.push(`${item.date},${item.clicks},${item.uniqueClicks}`);
    });
    sections.push('');

    // Top countries
    sections.push('TOP COUNTRIES');
    sections.push('Country,Country Code,Clicks,Percentage');
    data.topCountries.forEach(item => {
      sections.push(`${item.country},${item.countryCode},${item.clicks},${item.percentage.toFixed(2)}%`);
    });
    sections.push('');

    // Top devices
    sections.push('TOP DEVICES');
    sections.push('Device,Clicks,Percentage');
    data.topDevices.forEach(item => {
      sections.push(`${item.device},${item.clicks},${item.percentage.toFixed(2)}%`);
    });
    sections.push('');

    // Top browsers
    sections.push('TOP BROWSERS');
    sections.push('Browser,Version,Clicks,Percentage');
    data.topBrowsers.forEach(item => {
      sections.push(`${item.browser},${item.version || 'N/A'},${item.clicks},${item.percentage.toFixed(2)}%`);
    });
    sections.push('');

    // Top referrers
    sections.push('TOP REFERRERS');
    sections.push('Referrer,Domain,Clicks,Percentage');
    data.topReferrers.forEach(item => {
      sections.push(`"${item.referrer}",${item.domain},${item.clicks},${item.percentage.toFixed(2)}%`);
    });

    return sections.join('\n');
  }

  /**
   * Generate PDF content (HTML format for printing)
   */
  private static generatePDFContent(data: AnalyticsData, includeCharts: boolean): string {
    const currentDate = new Date().toLocaleDateString();
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Analytics Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .section { margin-bottom: 30px; }
          .section h2 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f8f9fa; font-weight: bold; }
          .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 20px; }
          .summary-card { border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
          .metric-value { font-size: 24px; font-weight: bold; color: #007bff; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Analytics Report</h1>
          <p>Generated on ${currentDate}</p>
        </div>

        <div class="section">
          <h2>Summary</h2>
          <div class="summary-grid">
            <div class="summary-card">
              <div class="metric-value">${data.totalClicks.toLocaleString()}</div>
              <div>Total Clicks</div>
            </div>
            <div class="summary-card">
              <div class="metric-value">${data.uniqueClicks.toLocaleString()}</div>
              <div>Unique Clicks</div>
            </div>
          </div>
        </div>

        <div class="section">
          <h2>Clicks by Date</h2>
          <table>
            <thead>
              <tr><th>Date</th><th>Total Clicks</th><th>Unique Clicks</th></tr>
            </thead>
            <tbody>
              ${data.clicksByDate.map(item => `
                <tr>
                  <td>${new Date(item.date).toLocaleDateString()}</td>
                  <td>${item.clicks}</td>
                  <td>${item.uniqueClicks}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2>Top Countries</h2>
          <table>
            <thead>
              <tr><th>Country</th><th>Code</th><th>Clicks</th><th>Percentage</th></tr>
            </thead>
            <tbody>
              ${data.topCountries.map(item => `
                <tr>
                  <td>${item.country}</td>
                  <td>${item.countryCode}</td>
                  <td>${item.clicks}</td>
                  <td>${item.percentage.toFixed(2)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2>Device Types</h2>
          <table>
            <thead>
              <tr><th>Device</th><th>Clicks</th><th>Percentage</th></tr>
            </thead>
            <tbody>
              ${data.topDevices.map(item => `
                <tr>
                  <td>${item.device}</td>
                  <td>${item.clicks}</td>
                  <td>${item.percentage.toFixed(2)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2>Top Referrers</h2>
          <table>
            <thead>
              <tr><th>Referrer</th><th>Domain</th><th>Clicks</th><th>Percentage</th></tr>
            </thead>
            <tbody>
              ${data.topReferrers.map(item => `
                <tr>
                  <td>${item.referrer}</td>
                  <td>${item.domain}</td>
                  <td>${item.clicks}</td>
                  <td>${item.percentage.toFixed(2)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Download file to user's device
   */
  private static downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  }

  /**
   * Get available export formats
   */
  static getAvailableFormats(): Array<{ value: ExportFormat; label: string; description: string }> {
    return [
      {
        value: 'csv',
        label: 'CSV',
        description: 'Comma-separated values for spreadsheet applications'
      },
      {
        value: 'excel',
        label: 'Excel',
        description: 'Microsoft Excel format'
      },
      {
        value: 'pdf',
        label: 'PDF',
        description: 'Portable Document Format for reports'
      },
      {
        value: 'json',
        label: 'JSON',
        description: 'JavaScript Object Notation for developers'
      }
    ];
  }
}

/**
 * Utility functions for data formatting
 */
export const formatUtils = {
  /**
   * Format number with commas
   */
  formatNumber: (num: number): string => {
    return num.toLocaleString();
  },

  /**
   * Format percentage
   */
  formatPercentage: (num: number, decimals = 1): string => {
    return `${num.toFixed(decimals)}%`;
  },

  /**
   * Format date for display
   */
  formatDate: (date: string | Date): string => {
    return new Date(date).toLocaleDateString();
  },

  /**
   * Format date range for display
   */
  formatDateRange: (start: Date, end: Date): string => {
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  }
};