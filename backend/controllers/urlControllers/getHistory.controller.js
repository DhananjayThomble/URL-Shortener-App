import UrlModel2 from "../../models/UrlModel2.js";

// Get the URL history for a user
export const getHistory = async (req, res) => {

  // get the list of shortened Urls, originalUrls and number of visits of each url associated with a user
  try {
    // get the Url object from the database using the userId provided in token
    const urlObj = await UrlModel2.findOne({ userId: req.user._id });

    // if user has a urlObject, send the urlArray(and array of objects where each object contains an originalUrl, shortenedUrl and number of visits) in response

    if (urlObj) {
      res.status(200).json({ urlArray: urlObj.urlArray });
    } else {
      // send an empty array indicating that the user has no record of shortened Urls
      res.status(200).json({ urlArray: [] });
    }
  } catch (error) {
    // log the error to the console
    console.error(error);

    // send 500 server error
    res.status(500).json({ error: "Server error" });
  }
};