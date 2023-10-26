import User from '../../models/UserModel.js';
import TokenModel from '../../models/Tokenmodel.js';
import dotenv from 'dotenv';
dotenv.config();

export const verifyEmail = async (req, res) => {
  try {
    // get token from request
    const { token } = req.query;

    // token is already validated by the middleware

    const verificationToken = await TokenModel.findOne({ token });

    // verify token
    if (!verificationToken) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    // get user by token id
    const user = await User.findById(verificationToken.userId);

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    user.isEmailVerified = true;

    //save user
    await user.save();

    await verificationToken.remove();

    console.log('Email verification done');

    return res.redirect('https://app.snapurl.in/login');
  } catch (error) {
    console.error('Error verifying email:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
