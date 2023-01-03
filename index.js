import { config } from "dotenv";

config();
const app = express();
import { nanoid } from "nanoid"; // for generating random id

import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import cors from "cors";
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

// process.cwd() is the current working directory
app.use("/public", express.static(`${process.cwd()}/public`));
app.use(cors()); // for cross origin resource sharing

// const urlArray = []; // array to store url and short url

app.get("/", function (req, res) {
  res.sendFile(process.cwd() + "/views/index.html");
});

//to validateUrl
const isValidUrl = (urlString) => {
  try {
    // Parse the URL and check if it is a valid URL
    let url = new URL(urlString);

    // Check if the URL has a protocol and hostname
    if (!url.protocol || !url.hostname) return false;

    // Check if the URL has a valid port
    if (url.port && isNaN(parseInt(url.port))) return false;

    // Check if the URL has any search parameters
    let searchParams = new URLSearchParams(url.search);
    if (searchParams.toString()) return true;

    // Return true if the URL is valid and has no search parameters
    return true;
  } catch (error) {
    // If the URL is invalid, return false
    return false;
  }
};

// Database connection
mongoose.set("strictQuery", false);
async function main() {
  mongoose.connect(process.env.DB_URL);
}
main().catch((err) => console.log(err));

const db = mongoose.connection;
db.on("error", console.error.bind(console, "DB connection error!"));
db.once("open", function () {
  console.log("Connected to DB");
});

// Creating Schema
const urlSchema = new mongoose.Schema({
  shortUrl: String,
  originalUrl: String,
});

// Creating model
const URLmodel = mongoose.model("url", urlSchema);

// get short url and redirect to original url
app.get("/api/shorturl/:short", (req, res) => {
  const shortUrl = req.params.short;

  // finding original url by shortUrl
  /*   for (let urlObj of urlArray) {
    if (urlObj.short === shortUrl) {
      res.redirect(urlObj.originalUrl);
      return;
    }
  } */

  //    getting data from db
  URLmodel.find({ shortUrl: shortUrl }, function (err, data) {
    if (err) {
      res.json({ error: "No url found!" });
    } else {
      const originalUrl = data[0].originalUrl;
      res.redirect(originalUrl);
      return;
    }
  });
});

// store url and return short url

app.post("/api/shorturl", (req, res) => {
  const url = req.body.url;
  // console.log("entered url - " + url);

  //validate url
  if (isValidUrl(url)) {
    //valid url
    const id = nanoid(10); // generate 10 character id // for collision probability: https://zelark.github.io/nano-id-cc/
    // urlArray.push({
    //   short: id,
    //   originalUrl: url,      // It was previously stored in array
    // });

    // storing data in db
    const myUrl = new URLmodel({
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
// for chrome extension
app.use("/get/short", bodyParser.json());
app.post("/get/short", (req, res) => {
  const url = req.body.url;
  if (isValidUrl(url)) {
    //valid url
    const id = nanoid(10); // generate 10 character id // for collision probability: https://zelark.github.io/nano-id-cc/
    // storing data in db
    const myUrl = new URLmodel({
      shortUrl: id,
      originalUrl: url,
    });
    myUrl.save(); //saving data

    res.json({
      short_url: id,
    });
  } else {
    // not valid url
    res.json({ error: "invalid url" });
  }
});

app.listen(port, function () {
  console.log(`Listening on port ${port}`);
});
