import express from "express";
const router = express.Router();
import UrlModel from "../models/urlModel.js";
import { nanoid } from "nanoid"; // for generating random id
import isValidUrl from "../utils.js"; // to validate url

// ---------------------------for chrome extension----------------------------

router.post("/", (req, res) => {
  const url = req.body.url;
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
      short_url: "https://app.dhananjaythomble.me/" + id,
    });
  } else {
    // not valid url
    res.json({ error: "invalid url" });
  }
});

export default router;
