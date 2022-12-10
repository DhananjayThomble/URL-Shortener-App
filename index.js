require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const bodyParser = require("body-parser");

// Basic Configuration
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));

// process.cwd() is the current working directory
app.use("/public", express.static(`${process.cwd()}/public`));

const urlArray = [];
let count = 1;

app.get("/", function (req, res) {
  res.sendFile(process.cwd() + "/views/index.html");
});

//to validateUrl
const isValidUrl = (urlString) => {
  let urlPattern = new RegExp(
    "^(https?:\\/\\/)?" + // validate protocol
      "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // validate domain name
      "((\\d{1,3}\\.){3}\\d{1,3}))" + // validate OR ip (v4) address
      "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // validate port and path
      "(\\?[;&a-z\\d%_.~+=-]*)?" + // validate query string
      "(\\#[-a-z\\d_]*)?$",
    "i"
  ); // validate fragment locator
  return urlPattern.test(urlString);
};

// get short url and redirect to original url
app.get("/api/shorturl/:short", (req, res) => {
  const shortUrl = req.params.short;
  // finding original url by shortUrl
  let originalUrl;

  for (let urlObj of urlArray) {
    if (urlObj.short == shortUrl) {
      originalUrl = urlObj.originalUrl;
    }
  }
  if (originalUrl) {
    res.redirect(originalUrl);
  }
});

// store url and return short url
app.post("/api/shorturl", (req, res) => {
  const url = req.body.url;
  // console.log("entered url - " + url);

  //validate url
  if (isValidUrl(url)) {
    //valid
    urlArray.push({
      short: count,
      originalUrl: url,
    });

    const jsonObj = {
      original_url: url,
      short_url: count,
    };
    res.json(jsonObj);
    count = count + 1;
  } else {
    // not valid url
    res.json({ error: "invalid url" });
  }

  // console.log(urlArray);
});

app.listen(port, function () {
  console.log(`Listening on port ${port}`);
});
