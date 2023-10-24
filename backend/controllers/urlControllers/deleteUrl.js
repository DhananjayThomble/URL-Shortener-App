import UrlModel from '../../models/UrlModel.js';

// Delete a URL associated with a user
export const deleteUrl = async (req, res) => {
  const id = req.params.id;
  try {
    const urlObj = await UrlModel.findOne({
      userId: req.user._id,
      urlArray: { $elemMatch: { shortUrl: id } },
    });
    if (urlObj) {
      // Remove the URL from the user's URL array
      urlObj.urlArray = urlObj.urlArray.filter((url) => url.shortUrl !== id);
      const status = await urlObj.save();
      if (status) {
        res.status(200).json({ ok: true });
      } else {
        res.status(500).json({ error: 'Server error' });
      }
    } else {
      res.status(404).json({ error: 'Url not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
