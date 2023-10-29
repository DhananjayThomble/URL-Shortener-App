import UrlModel from '../../models/UrlModel.js';

// Redirect to the original URL associated with a short URL
export const redirectToOriginalUrl = async (req, res) => {
  try {
    const { short } = req.params;

    const url = await UrlModel.findOne({ shortUrl: short });

    // if the URL does not exist
    if (!url) {
      return res.status(404).json({ error: 'Url not found' });
    }

    // increment the URL visit count
    const visitCount = url.visitCount || 0;
    await url.updateOne({ visitCount: visitCount + 1 });

    // Perform a 302 redirect to the original URL
    res.status(302).redirect(url.originalUrl);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const redirectViaCustomBackHalf = async (req, res) => {
  try {
    const { backHalf } = req.params;

    const url = await UrlModel.findOne({ customBackHalf: backHalf });

    // if the URL does not exist
    if (!url) {
      return res.status(404).json({ error: 'Url not found' });
    }

    // increment the URL visit count
    const visitCount = url.visitCount || 0;
    await url.updateOne({ visitCount: visitCount + 1 });

    // Perform a 302 redirect to the original URL
    res.status(302).redirect(url.originalUrl);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
