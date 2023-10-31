import { nanoid } from 'nanoid';
import UrlModel from '../../models/UrlModel.js';

// Generate a short URL for a given long URL
export const generateShortUrl = async (req, res) => {
  const SHORT_URL_PREFIX = process.env.SHORT_URL_PREFIX;
  try {
    const { url } = req.body;

    // Get the user ID from the request
    const userId = req.user._id;

    // Get the URL details from the database
    const urlDetails = await UrlModel.findOne(
      { originalUrl: url, userId },
      { shortUrl: 1, customBackHalf: 1, _id: 0 },
    );
    // console.log(`urlDetails: ${urlDetails}`);

    if (urlDetails) {
      // if the URL has already been shortened for the user, return the existing short URL
      const { shortUrl, customBackHalf } = urlDetails;
      return res.status(200).json({
        shortUrl: `${SHORT_URL_PREFIX}/${shortUrl}`,
        customBackHalf: customBackHalf,
      });
    }

    // If the URL has not been shortened for the user, generate a new short URL
    const id = nanoid(10);

    await UrlModel.create({
      userId,
      shortUrl: id,
      originalUrl: url,
    });

    // Send response with the generated short URL
    res.status(200).json({
      shortUrl: `${SHORT_URL_PREFIX}/${id}`,
      customBackHalf: null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
