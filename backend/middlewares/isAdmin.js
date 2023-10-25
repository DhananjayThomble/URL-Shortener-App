import Admin from '../models/AdminModel.js';
export const isAdmin = async (req, res, next) => {
  try {
    const user = await Admin.findById(req.user._id);

    if (!user) {
      return res
        .status(401)
        .json({ error: 'adminControllers resource. Access denied' });
    }

    // If user is an adminControllers, set it in req.profile
    req.profile = user;
    next();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};
