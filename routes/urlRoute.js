import express from "express";
const router = express.Router();
import { nanoid } from "nanoid";
import UrlModel from "../models/urlModel.js";
import isValidUrl from "../utils.js";

router.get("/", function (req, res) {
  res.sendFile(process.cwd() + "/views/index.html");
});

router.get("/:short", (req, res) => {
  const shortUrl = req.params.short;
  //    getting data from db
  UrlModel.find({ shortUrl: shortUrl }, function (err, data) {
    if (err) {
      res.json({ error: "No url found!" });
    } else {
      const originalUrl = data[0].originalUrl;
      res.redirect(originalUrl);
    }
  });
});

router.post("/", (req, res) => {
  const url = req.body.url;
  // console.log("entered url - " + url);

  //validate url
  if (isValidUrl(url)) {
    //valid url
    const id = nanoid(10); // generate 10 character id // for collision probability: https://zelark.github.io/nano-id-cc/

    // storing data in db
    const myUrl = new UrlModel({
      shortUrl: id,
      originalUrl: url,
    });
    myUrl.save(); //saving data

    res.json({
      original_url: url,
      short_url: id,
    });
  } else {
    // not valid url
    res.json({ error: "invalid url" });
  }
});

export default router;
