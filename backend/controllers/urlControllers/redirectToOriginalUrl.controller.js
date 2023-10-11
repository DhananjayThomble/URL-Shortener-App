import UrlModel2 from "../../models/UrlModel2.js";
import { validationResult } from "express-validator";

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

// Redirect to the original URL associated with a short URL
export const redirectToOriginalUrl = async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const shortUrl = req.params.shortUrl;

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
    // log error to console
    console.error(error);

    // send 500 server error
    res.status(500).json({ error: "Server error" });
  }
};

  
