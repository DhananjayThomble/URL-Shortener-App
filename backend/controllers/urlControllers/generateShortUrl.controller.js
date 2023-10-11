import UrlModel2 from "../../models/UrlModel2.js";
import { nanoid } from "nanoid";
import { validationResult } from "express-validator";
import { SHORT_URL_PREFIX } from "../../extras/Constants.js";

// generate shortUrl from original url
export const generateShortUrl = async (req, res) => {
  try {

    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // get the original url from the request body
    const url = req.body.url;

    // generate shortUrl
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