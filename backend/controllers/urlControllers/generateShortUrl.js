import UrlModel from '../../models/UrlModel.js';
import { nanoid } from 'nanoid';
import { SHORT_URL_PREFIX } from '../../extras/Constants.js';

// Generate a short URL for a given long URL
export const generateShortUrl = async (req, res) => {
  try {
    const { url } = req.body;
    const id = nanoid(10);

    // Get the user ID from the request
    const userId = req.user._id;
    const urlObj = req.userId;
    const customId = req.custom;
    // console.log(`customId : ${customId}`);

    if (urlObj) {
      // Append the new URL to the existing array
      urlObj.urlArray.push({
        shortUrl: id,
        originalUrl: url,
        customUrl: customId,
      });
      await urlObj.save();
    } else {
      // Create a new collection for the user
      const myModel = new UrlModel();
      myModel.userId = userId;
      myModel.urlArray.push({
        shortUrl: id,
        originalUrl: url,
        customUrl: customId,
      });
      await myModel.save();
    }

    // Send response with the generated short URL
    // value of SHORT_URL_PREFIX is http://localhost:4001/u/ and for production : https://dturl.live/u/
    res.status(200).json({
      shortUrl: `${SHORT_URL_PREFIX}${id}`,
      customUrl: `${SHORT_URL_PREFIX}${customId}`,
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(400).json({
        error:
          'Sorry, the custom word you chose has already been registered. Please try a different one!',
      });
    }
    res.status(500).json({ error: 'Server error' });
  }
};
