import UrlModel from '../../models/UrlModel.js';

// Get the URL history for a user
export const getHistory = async (req, res) => {
  try {
    const urlObj = await UrlModel.findOne({ userId: req.user._id });
    if (urlObj) {
      res.status(200).json({ urlArray: urlObj.urlArray });
    } else {
      res.status(200).json({ urlArray: [] });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
