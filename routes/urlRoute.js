import express from "express";
import { nanoid } from "nanoid";
import UrlModel from "../models/urlModel.js";
import isValidUrl from "../utils.js";
import { isAuthenticated } from "../utils.js";
import UrlModel2 from "../models/UrlModel2.js";

const router = express.Router();

router.get("/", function (req, res) {
  // res.sendFile(process.cwd() + "/views/index.html");
  // console.log(req.user);    // display all data of authenticated user
  // console.log(req.isAuthenticated());
  if (req.isAuthenticated()) {
    process.env.IS_LOGGED_IN = true;  //- store 'login in' status of user, to be used in navbar
  }
  res.render("index");
});

router.get("/url/:short", (req, res) => {
  const shortUrl = req.params.short;

  UrlModel2.findOne({ "urlArray.shortUrl": shortUrl })
    .select({ "urlArray.$": 1 })
    .exec(function (err, url) {
      if (err) {
        console.error(err);
      } else {
        res.redirect(url.urlArray[0].originalUrl);
      }
    });
});

router.get("/history", isAuthenticated, (req, res) => {
  UrlModel2.findOne({ userId: req.user._id }, (err, urlObj) => {
    if(err){
      console.error(err);
      return;
    }
    if (urlObj) {
      res.render("history", { urlArray: urlObj.urlArray });
    } else {
      res.render("history", { urlArray: [] });
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

    //  storing data in db
    const userId = req.user._id;
    // isUserRegistered ? append the url object to existing array of that user : create new collection for 1 time only
    UrlModel2.findOne({ userId: userId }, (err, urlObj) => {
      if (urlObj) {
        urlObj.urlArray.push({
          shortUrl: id,
          originalUrl: url,
        });
        urlObj.save();
      } else {
        // create new collection and store user and urls
        const myModel = new UrlModel2();
        myModel.userId = userId;
        myModel.urlArray.push({
          shortUrl: id,
          originalUrl: url,
        });
        myModel.save();
      }
    });

    res.json({
      original_url: url,
      short_url: `https://app.dhananjaythomble.me/url/${id}`,
    });
  } else {
    // not valid url
    res.json({ error: "invalid url" });
  }
});

export default router;
