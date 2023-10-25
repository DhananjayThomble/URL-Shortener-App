import UrlModel from '../../models/UrlModel.js';

export const getFilteredCategory = async (req, res) => {
  try {
    const urlObj = await UrlModel.findOne({
      userId: req.user._id,
    });
    if (urlObj) {
      const filteredUrlArray = urlObj.urlArray.filter(
        (url) =>
          url.category &&
          url.category.toLowerCase() === req.params.category.toLowerCase(),
      );
      res.status(200).json({ urlArray: filteredUrlArray });
    } else {
      res.status(200).json({ urlArray: [] });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const addCategory = async (req, res) => {
  try {
    const urlObj = await UrlModel.findOne({
      userId: req.user._id,
    });
    if (urlObj) {
      urlObj.urlArray.push({
        shortUrl: req.shortUrl,
        originalUrl: req.originalUrl,
        category: req.params.category,
        customUrl: req.customUrl,
      });
      const savedUrlObj = await urlObj.save();
      res.status(200).json({ urlArray: savedUrlObj.urlArray });
    } else {
      const newUrlObj = new UrlModel({
        userId: req.user._id,
        urlArray: [
          {
            shortUrl: req.shortUrl,
            originalUrl: req.originalUrl,
            category: req.params.category,
            customUrl: req.customUrl,
          },
        ],
      });
      const savedUrlObj = await newUrlObj.save();
      res.status(200).json({ urlArray: savedUrlObj.urlArray });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const urlObj = await UrlModel.findOne({
      userId: req.user._id,
    });
    if (urlObj) {
      const urlArray = urlObj.urlArray;
      const index = urlArray.findIndex(
        (url) => url.shortUrl === req.body.shortUrl,
      );
      if (index !== -1) {
        urlArray[index].category = req.body.category;
        const savedUrlObj = await urlObj.save();
        res.status(200).json({ urlArray: savedUrlObj.urlArray });
      } else {
        res.status(404).json({ error: 'URL not found' });
      }
    } else {
      const newUrlObj = new UrlModel({
        userId: req.user._id,
        urlArray: [
          {
            shortUrl: req.shortUrl,
            originalUrl: req.originalUrl,
            category: req.params.category,
            customUrl: req.customUrl,
          },
        ],
      });
      const savedUrlObj = await newUrlObj.save();
      res.status(200).json({ urlArray: savedUrlObj.urlArray });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
