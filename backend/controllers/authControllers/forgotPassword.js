import User from '../../models/UserModel.js';
import crypto from 'crypto';
import TokenModel from '../../models/Tokenmodel.js';
import { sendPasswordResetEmail } from '../../utils/mailSend.js';
import dotenv from 'dotenv';
dotenv.config();

const generatePasswordResetToken = async (userId) => {
  // generate password reset token
  const token = crypto.randomBytes(32).toString('hex');
  const expiration = Date.now() + 3600000; // 1 hour from now

  const resetToken = new TokenModel({
    userId,
    token,
    expiration,
  });

  // save password reset token in database
  await resetToken.save();

  return token;
};

// Forgot Password controller
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    // check that email existis in database or not
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'Email not found' });
    }

    const token = await generatePasswordResetToken(user._id);

    // send password reset token
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    await sendPasswordResetEmail(email, resetLink);

    return res.status(200).json({ message: 'Password reset email sent' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
