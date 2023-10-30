import UrlModel from '../../models/UrlModel.js';
import { generate } from 'random-words';

// Generate a custom back-half of a short URL for a given short URL
export const generateCustomBackHalf = async (req, res) => {
  try {
    const { backHalf, shortUrl } = req.body;
    const userId = req.user._id;

    // check if the custom back-half already exists
    const existingUrl = await UrlModel.findOne({ customBackHalf: backHalf });

    if (existingUrl) {
      // generate a random back-half, if custom one already exists
      const randomBackHalf = generate({ minLength: 3, maxLength: 10 });

      return res.status(400).json({
        error: 'Custom back-half already exists',
        suggestion: randomBackHalf,
      });
    }

    // update the URL with the custom back-half
    const updatedUrl = await UrlModel.findOneAndUpdate(
      { userId, shortUrl },
      { customBackHalf: backHalf },
      { new: true }
    );
    // console.log('Updated url data:', updatedUrl);

    // If the URL does not exist, return an error
    if (!updatedUrl) {
      return res.status(400).json({
        error: 'URL does not exist',
      });
    }

    // Send response with the success message
    res.status(200).json({
      message: 'Custom back-half generated',
      customBackHalf: updatedUrl.customBackHalf
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server Error' });
  }
};
