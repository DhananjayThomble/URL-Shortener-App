import UrlModel2 from "../../models/UrlModel2.js";

// Delete a URL associated with a user
export const deleteUrl = async (req, res) => {
  // get short url Id from request.params
  const shortUrlId = req.params.shortUrlId;

  // find the Url object associated with the authenticated userId(gotten from isApiAuthenticated middleware) and the shortUrlId from the database
  try {

    const urlObj = await UrlModel2.findOne({
      userId: req.user._id,
      urlArray: { $elemMatch: { shortUrl: shortUrlId } },
    });

    console.log(`id: ${shortUrlId} `, `user: ${req.user}` )
    
    // if UrlObject exists, delete the ShortUrl and its associated information from the User's UrlObject in the database, else, send a url not found 404 error

    if (urlObj) {
      // Remove the URL from the user's URL array
      urlObj.urlArray = urlObj.urlArray.filter((url) => url.shortUrl !== shortUrlId);

      // save the UrlObject with the filetered shortUrl in the database. Throw a 500 error if this operation fails
      const status = await urlObj.save();
      if (status) {
        res.status(200).json({ ok: true });
      } else {
        res.status(500).json({ error: "Server error" });
      }


    } else {
      res.status(404).json({ error: "Url not found" });
    }
  } catch (error) {
    // log error to the console
    console.error(error);

    // send server error
    res.status(500).json({ error: "Server error" });
  }
};