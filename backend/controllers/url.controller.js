import UrlModel2 from "../models/UrlModel2.js";
import { nanoid } from "nanoid";
import ExcelJS from "exceljs";
import { SHORT_URL_PREFIX } from "../extras/Constants.js";

// Redirect to the original URL associated with a short URL
export const redirectToOriginalUrl = async (req, res) => {
  try {
    const shortUrl = req.params.short;

    // Find the URL object with the short URL in the database
    const url = await UrlModel2.findOne({
      "urlArray.shortUrl": shortUrl,
    }).select({ "urlArray.$": 1 });

    // Check if the URL is present in the database
    if (!url) {
      res.status(404).json({ error: "Url not found" });
      return;
    }

    // Increment the URL visit count
    const visitCount = url.urlArray[0].visitCount || 0;
    await countUrlVisit(shortUrl, visitCount);

    // Perform a 302 redirect to the original URL
    res.status(302).redirect(url.urlArray[0].originalUrl);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

// Increment the visit count for a URL
async function countUrlVisit(urlID, visitCount) {
  try {
    // Find the URL object containing the URL ID and increment the visit count
    const urlObj = await UrlModel2.findOneAndUpdate(
      { "urlArray.shortUrl": urlID },
      { $set: { "urlArray.$.visitCount": visitCount + 1 } }
    );
    if (!urlObj) {
      console.error("URL not found");
    }
  } catch (error) {
    console.error(error);
  }
}

//-----------------------------------generateShortUrl-----------------------------------
// Generate a short URL for a given long URL
export const generateShortUrl = async (req, res) => {
  try {
    const url = req.body.url;
    const id = nanoid(10);

    // Get the user ID from the request
    const userId = req.user._id;

    // Check if the user already has an associated URL object in the database
    const urlObj = await UrlModel2.findOne({ userId: userId });
    if (urlObj) {
      // Append the new URL to the existing array
      urlObj.urlArray.push({
        shortUrl: id,
        originalUrl: url,
        visitCount: 0,
      });
      await urlObj.save();
    } else {
      // Create a new collection for the user
      const myModel = new UrlModel2();
      myModel.userId = userId;
      myModel.urlArray.push({
        shortUrl: id,
        originalUrl: url,
        visitCount: 0,
      });
      await myModel.save();
    }

    // Send response with the generated short URL
    res.status(200).json({ shortUrl: `${SHORT_URL_PREFIX}${id}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

//------------------------------------------getHistory------------------------------------------
// Get the URL history for a user
export const getHistory = async (req, res) => {
  try {
    const urlObj = await UrlModel2.findOne({ userId: req.user._id });
    if (urlObj) {
      res.status(200).json({ urlArray: urlObj.urlArray });
    } else {
      res.status(200).json({ urlArray: [] });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

//------------------------------------------deleteUrl------------------------------------------
// Delete a URL associated with a user
export const deleteUrl = async (req, res) => {
  const id = req.params.id;
  try {
    const urlObj = await UrlModel2.findOne({
      userId: req.user._id,
      urlArray: { $elemMatch: { shortUrl: id } },
    });
    if (urlObj) {
      // Remove the URL from the user's URL array
      urlObj.urlArray = urlObj.urlArray.filter((url) => url.shortUrl !== id);
      const status = await urlObj.save();
      if (status) {
        res.status(200).json({ ok: true });
      } else {
        res.status(500).json({ error: "Server error" });
      }
    } else {
      res.status(404).json({ error: "Url not found" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

//------------------------------------------export Generated URLs for user------------------------------------------
// Export the generated URLs for a user as an Excel spreadsheet
export const exportGeneratedUrls = async (req, res) => {
  try {
    const urlObj = await UrlModel2.findOne({ userId: req.user._id });
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
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};
