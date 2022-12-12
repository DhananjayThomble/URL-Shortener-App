import {config} from "dotenv";

config();
const app = express();
import {nanoid} from "nanoid"; // for generating random id

// Basic Configuration
import express from "express";

import bodyParser from "body-parser";

const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({extended: false}));

// process.cwd() is the current working directory
app.use("/public", express.static(`${process.cwd()}/public`));

const urlArray = []; // array to store url and short url

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

// get short url and redirect to original url
app.get("/api/shorturl/:short", (req, res) => {
    const shortUrl = req.params.short;

    // finding original url by shortUrl
    for (let urlObj of urlArray) {
        if (urlObj.short === shortUrl) {
            res.redirect(urlObj.originalUrl);
            return;
        }
    }
    res.json({error: "No url found!"});
});

// store url and return short url
app.post("/api/shorturl", (req, res) => {
    const url = req.body.url;
    // console.log("entered url - " + url);

    //validate url
    if (isValidUrl(url)) {
        //valid url
        const id = nanoid(10); // generate 10 character id // for collision probability: https://zelark.github.io/nano-id-cc/
        urlArray.push({
            short: id,
            originalUrl: url,
        });

        res.json({
            original_url: url,
            short_url: id,
        });
    } else {
        // not valid url
        res.json({error: "invalid url"});
    }
});

app.listen(port, function () {
    console.log(`Listening on port ${port}`);
});
