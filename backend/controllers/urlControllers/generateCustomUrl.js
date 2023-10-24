import UrlModel from '../../models/UrlModel.js';
import { generate } from 'random-words';

// Generate a custom URL for a given long URL
export const generateCustomUrl = async (req, res, next) => {
  try {
    const { customUser, url } = req.body;

    const userId = req.user._id;

    // Check if the user already has an associated URL object in the database
    const urlObj = await UrlModel.findOne({ userId: userId });
    req.userId = urlObj;

    if (customUser) {
      const cleanCustom = customUser.split(' ').join('');

      // Check if the customUrl already exists in the database,
      // only getting required fields rather than the whole document, to improve performance
      const existingUrl = await UrlModel.findOne({
        'urlArray.customUrl': cleanCustom.toLowerCase(),
      });

      // If the customUrl already exists, return an error
      if (existingUrl) {
        return res.status(400).json({
          error: `Sorry, the custom word you chose has already been registered. Please try a different one!`,
        });
      }

      req.custom = cleanCustom.toLowerCase();
      return next();
    }

    req.custom = generate({ minLength: 3, maxLength: 11 });
    next();
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Server Error' });
  }
};
