import UrlModel from '../../models/UrlModel.js';

export const getFilteredCategory = async (req, res) => {
  const userId = req.user._id;
  const category = req.params.category;
  try {
    const urls = await UrlModel.find({
      userId,
      category,
    });

    res.status(200).json({ urls });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const updateCategory = async (req, res) => {
  const userId = req.user._id;
  const category = req.params.category;
  const shortUrl = req.body.shortUrl;
  try {
    const updatedUrl = await UrlModel.findOneAndUpdate(
      { userId, shortUrl }, // query
      { category }, // update
    );

    if (!updatedUrl) {
      return res.status(404).json({ error: 'URL not found' });
    }

    res.status(200).json({ message: 'Category updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
