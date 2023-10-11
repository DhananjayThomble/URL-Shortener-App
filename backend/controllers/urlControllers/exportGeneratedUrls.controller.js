import UrlModel2 from "../../models/UrlModel2.js";
import ExcelJS from "exceljs";
import { SHORT_URL_PREFIX } from "../../extras/Constants.js";

// export all User generatedUrls and associated information  
export const exportGeneratedUrls = async (req, res) => {

  try {
    // find User UrlObj from the database
    const urlObj = await UrlModel2.findOne({ userId: req.user._id });

    //create the excel file containing the information from the User UrlObj and send in response
    if (urlObj && urlObj.urlArray.length) {
      // also check if array has item

      // Create a new workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "DT URL Shortener";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Generated_URLs");

      // Add headers to the worksheet
      worksheet.columns = [
        { header: "Short URL", key: "shortUrl", width: 50 },
        { header: "Original URL", key: "originalUrl", width: 50 },
        { header: "Visits", key: "visits", width: 10 },
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
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      // Send the Excel file to the client
      const buffer = await workbook.xlsx.writeBuffer();

      // Set the file name
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Generated_URLs.xlsx"
      );
      res.status(200).send(buffer);
    } else {
      // Data not found
      res.status(404).json({ error: "No Generated URL found" });
    }
  } catch (error) {
    // log error to the console
    console.error(error);

    // send 500 server error
    res.status(500).json({ error: "Server error" });
  }
};