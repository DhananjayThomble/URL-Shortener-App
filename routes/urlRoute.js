import express from "express";
import { nanoid } from "nanoid";
import UrlModel from "../models/urlModel.js";
import isValidUrl from "../utils.js";
import { isAuthenticated } from "../utils.js";

const router = express.Router();

router.get("/", function (req, res) {
  // res.sendFile(process.cwd() + "/views/index.html");
  // console.log(req.user);    // display all data of authenticated user
  // console.log(req.isAuthenticated());
  if (req.isAuthenticated()) {
    process.env.IS_LOGGED_IN = true;
  }
  res.render("index");
});

router.get("/url/:short", (req, res) => {
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

router.post("/", isAuthenticated, (req, res) => {
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
      final_url: `https://app.dhananjaythomble.me/url/${id}`,
    });
  } else {
    // not valid url
    res.json({ error: "invalid url" });
  }
});

export default router;
