import UrlModel2 from "../models/UrlModel2.js";
import { nanoid } from "nanoid";
import { generate } from "random-words";
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

//-----------------------------------generateCustomUrl-----------------------------------
// Generate a custom URL for a given long URL
export const generateCustomUrl = async (req, res, next) => {
  try {
    const { customUser, url } = req.body;

    const userId = req.user._id;

    // Check if the user already has an associated URL object in the database
    const urlObj = await UrlModel2.findOne({ userId: userId });
    req.userId = urlObj;

    if (customUser) {
      const cleanCustom = customUser.split(" ").join("");

      // Check if the customUrl already exists in the database,
      // only getting required fields rather than the whole document, to improve performance
      const existingUrl = await UrlModel2.findOne({
        "urlArray.customUrl": cleanCustom.toLowerCase(),
      });

      // If the customUrl already exists, return an error
      if (existingUrl) {
        return res.status(400).json({
          error: `Sorry, the custom word you chose has already been registered. Please try a different one!`,
        });
      }

      req.custom = cleanCustom.toLowerCase();
      return next();
    }

    req.custom = generate({ minLength: 3, maxLength: 11 });
    next();
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Server Error" });
  }
};

//-----------------------------------generateShortUrl-----------------------------------
// Generate a short URL for a given long URL
export const generateShortUrl = async (req, res) => {
  try {
    const { url } = req.body;
    const id = nanoid(10);

    // Get the user ID from the request
    const userId = req.user._id;
    const urlObj = req.userId;
    const customId = req.custom;
    // console.log(`customId : ${customId}`);

    if (urlObj) {
      // Append the new URL to the existing array
      urlObj.urlArray.push({
        shortUrl: id,
        originalUrl: url,
        customUrl: customId,
      });
      await urlObj.save();
    } else {
      // Create a new collection for the user
      const myModel = new UrlModel2();
      myModel.userId = userId;
      myModel.urlArray.push({
        shortUrl: id,
        originalUrl: url,
        customUrl: customId,
      });
      await myModel.save();
    }

    // Send response with the generated short URL
    // value of SHORT_URL_PREFIX is http://localhost:4001/u/ and for production : https://dturl.live/u/
    res.status(200).json({
      shortUrl: `${SHORT_URL_PREFIX}${id}`,
      customUrl: `${SHORT_URL_PREFIX}${customId}`,
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(400).json({
        error:
          "Sorry, the custom word you chose has already been registered. Please try a different one!",
      });
    }
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

const getDomain = (url) => {
  const urls = new URL(url);
  const domain = urls.host;
  const url_part = domain.split(".");
  return url_part[url_part.length - 2] + ".com";
};
