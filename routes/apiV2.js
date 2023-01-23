import express from "express";
import { nanoid } from "nanoid";
import isValidUrl from "../utils.js";
import { isAuthenticated } from "../utils.js";
import UrlModel2 from "../models/UrlModel2.js";

const router = express.Router();

router.get("/url/:short", async (req, res) => {
  const shortUrl = req.params.short;

  try {
    const url = await UrlModel2.findOne({
      "urlArray.shortUrl": shortUrl,
    }).select({ "urlArray.$": 1 });
    res.redirect(url.urlArray[0].originalUrl);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

router.get("/history", isAuthenticated, async (req, res) => {
  try {
    const urlObj = await UrlModel2.findOne({ userId: req.user._id });
    if (urlObj) {
      res.status(200).json({ urlArray: urlObj.urlArray });
    } else {
      res.status(200).json({ urlArray: [] });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

router.post("/", isAuthenticated, async (req, res) => {
  const url = req.body.url;

  if (!isValidUrl(url)) {
    res.status(400).json({ error: "invalid url" });
    return;
  }

  const id = nanoid(10);
  const userId = req.user._id;
  // isUserRegistered ? append the url object to existing array of that user : create new collection for 1 time only
  try {
    const urlObj = await UrlModel2.findOne({ userId: userId });
    if (urlObj) {
      urlObj.urlArray.push({
        shortUrl: id,
        originalUrl: url,
      });
      await urlObj.save();
    } else {
      const myModel = new UrlModel2();
      myModel.userId = userId;
      myModel.urlArray.push({
        shortUrl: id,
        originalUrl: url,
      });
      await myModel.save();
    }
    // send response
    res
      .status(200)
      .json({ shortUrl: `https://app.dhananjaythomble.me/url/${id}` });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

export default router;
