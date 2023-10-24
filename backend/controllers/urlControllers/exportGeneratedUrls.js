// Export the generated URLs for a user as an Excel spreadsheet
import ExcelJS from 'exceljs';
import UrlModel from '../../models/UrlModel.js';

export const exportGeneratedUrls = async (req, res) => {
  try {
    const urlObj = await UrlModel.findOne({ userId: req.user._id });
    if (urlObj && urlObj.urlArray.length) {
      // also check if array has item

      // Create a new workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'DT URL Shortener';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Generated_URLs');

      // Add headers to the worksheet
      worksheet.columns = [
        { header: 'Short URL', key: 'shortUrl', width: 50 },
        { header: 'Original URL', key: 'originalUrl', width: 50 },
        { header: 'Visits', key: 'visits', width: 10 },
      ];

      // Make header row bold
      worksheet.getRow(1).font = { bold: true };

      // Add data to the sheet
      urlObj.urlArray.forEach((url) => {
        worksheet.addRow({
          shortUrl: SHORT_URL_PREFIX + url.shortUrl,
          originalUrl: url.originalUrl,
          visits: url.visitCount,
        });
      });

      // Set the response headers
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      // Send the Excel file to the client
      const buffer = await workbook.xlsx.writeBuffer();
      // Set the file name
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=Generated_URLs.xlsx',
      );
      res.status(200).send(buffer);
    } else {
      // Data not found
      res.status(404).json({ error: 'No Generated URL found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
