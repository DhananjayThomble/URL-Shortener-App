import User from '../../models/UserModel.js';
import TokenModel from '../../models/Tokenmodel.js';
import dotenv from 'dotenv';
dotenv.config();

export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    // get reset password token from database
    const resetToken = await TokenModel.findOne({ token });

    // verify expiration date of reset password token
    if (!resetToken || resetToken.expiration < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    // update user Password if token is valid
    const user = await User.findById(resetToken.userId);
    user.password = password;
    await user.save();

    // remove password reset token from database
    await resetToken.remove();

    return res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
