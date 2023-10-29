import UrlModel from '../../models/UrlModel.js';

// Delete a URL associated with a user
export const deleteUrl = async (req, res) => {
  const id = req.params.id;
  const userId = req.user._id;
  try {
    // Delete the URL from the database
    const deletedUrl = await UrlModel.findOneAndDelete({
      userId,
      shortUrl: id,
    });

    // if the URL does not exist
    if (!deletedUrl) {
      return res.status(400).json({
        error: 'URL does not exist',
      });
    }

    // send response with the success message
    res.status(200).json({
      message: 'URL deleted',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
