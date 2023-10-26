import Admin from '../../models/AdminModel.js';
import crypto from 'crypto';
import TokenModel from '../../models/Tokenmodel.js';
import { sendEmail } from '../../utils/mailSend.js';
import dotenv from 'dotenv';
dotenv.config();

const generatePasswordResetToken = async (email) => {
  // get user from database
  const user = await Admin.findOne({ email });

  if (!user) {
    throw new Error('User not found');
  }

  // generate password reset token
  const token = crypto.randomBytes(32).toString('hex');
  const expiration = Date.now() + 3600000;

  const resetToken = new TokenModel({
    userId: user._id,
    token,
    expiration,
  });

  // save password reset token in database
  await resetToken.save();

  // send password reset token
  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  const emailOptions = {
    from: 'SnapURL@dturl.live',
    subject: 'Password Reset for SnapURL',
    recipient: email,
    html: `Click <a href="${resetLink}">here</a> to reset your password.`,
  };

  await sendEmail(emailOptions);
};

// Forgot Password controller
export const adminForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    // check that email existis in database or not
    const result = await Admin.findOne({ email });
    if (!result) {
      return res.status(404).json({ message: 'Email not found' });
    }

    await generatePasswordResetToken(email);
    return res.status(200).json({ message: 'Password reset email sent' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
