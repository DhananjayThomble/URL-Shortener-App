import User from "../models/UserModel.js";
import crypto from "crypto";
import TokenModel from "../models/Tokenmodel.js";
import jwt from "jsonwebtoken";
import { sendEmail,sendVerificationEmail,sendWelcomeEmail } from "../utils/mailSend.js";
import dotenv from "dotenv";
dotenv.config();

//-----------------------------------------------------Login--------------------------------------------------------------

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) return res.status(401).json({ error: "Email does not exist" });

    user.comparePassword(password, (err, isMatch) => {
      if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

      const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      const { _id, name, email } = user;
      return res.status(200).json({ token, user: { _id, name, email } });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

export const signup = async (req, res) => {
  try {
    const { name, password } = req.body;

    if (!name || name.length < 3)
      return res.status(400).json({
        error: "Name is required and should be at least 3 characters long",
      });
    if (!password || password.length < 6)
      return res.status(400).json({
        error: "Password is required and should be at least 6 characters long",
      });

    const user = new User(req.body);

    await user.save();
    console.log("User saved");

    // Sending the welcome email
    await sendVerificationEmail(user.email);
    await sendWelcomeEmail(user.name, user.email);
    

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.log("CREATE USER FAILED", err);
    return res
      .status(500)
      .json({ error: "Error saving user in database. Try later" });
  }
};

const generatePasswordResetToken = async (email) => {
  const user = await User.findOne({ email });

  if (!user) {
    throw new Error("User not found");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiration = Date.now() + 3600000;

  const resetToken = new TokenModel({
    userId: user._id,
    token,
    expiration,
  });

  await resetToken.save();

  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  const emailOptions = {
    from: "SnapURL@dturl.live",
    subject: "Password Reset for SnapURL",
    recipient: email,
    html: `Click <a href="${resetLink}">here</a> to reset your password.`,
  };

  await sendEmail(emailOptions);
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    await generatePasswordResetToken(email);
    return res.status(200).json({ message: "Password reset email sent" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    const resetToken = await TokenModel.findOne({ token });

    if (!resetToken || resetToken.expiration < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const user = await User.findById(resetToken.userId);
    user.password = password;
    await user.save();

    await resetToken.remove();

    return res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    const verificationToken = await TokenModel.findOne({ token });

    if (!verificationToken) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const user = await User.findById(verificationToken.userId);

    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ error: "Email already verified" });
    }

    user.isEmailVerified = true;
    await user.save();

    await verificationToken.remove();

    return res.status(200).json({ message: "Email verification successful" });
    console.log("varification done");
  } catch (error) {
    console.error("Error verifying email:", error);
    res.status(500).json({ error: "Server error" });
  }
};
