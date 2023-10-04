import User from "../models/UserModel.js";
import crypto from "crypto";
import TokenModel from "../models/Tokenmodel.js";
import jwt from "jsonwebtoken";
import {sendEmail} from "../utils/mailSend.js"
import dotenv from "dotenv"
dotenv.config()
import fs from "fs"
import ejs from "ejs"


//-----------------------------------------------------Login--------------------------------------------------------------
// for sending the email

const sendWelcomeEmail = async (name, email, userID) => {
  try {
    const verifyEmailTemplate = fs.readFileSync(
      "./views/welcome_email_template.ejs",
      "utf-8",
    );

    const dataToRender = {
      name: name,
    };

    const htmlTemplate = ejs.render(verifyEmailTemplate, dataToRender);

    const options = {
      from:"SnapURL@dturl.live",
      subject: "Welcome to SnapURL !!!",
      recipient: email,
      html: htmlTemplate,
    };

    await sendEmail(options);
  } catch (err) {
    console.error(err);
  }
};


export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    // if user not found, 401 status for unauthorized
    if (!user) return res.status(401).json({ error: "Email does not exist" });

    // check password using passport
    user.comparePassword(password, (err, isMatch) => {
      if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

      // password matched, create a token
      const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      // send token in response
      const { _id, name, email } = user;
      return res.status(200).json({ token, user: { _id, name, email } });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

//-----------------------------------------------------Signup--------------------------------------------------------------
export const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || name.length < 3)
      return res.status(400).json({
        error: "Name is required and should be min 3 characters long",
      });
    if (!password || password.length < 6)
      return res.status(400).json({
        error: "Password is required and should be min 6 characters long",
      });

   
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }

  // register
  const user = new User(req.body);
  try {
    await user.save();
    console.log("user saved");
    
    // sending the mail
    sendWelcomeEmail(user.name,user.email)
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.log("CREATE USER FAILED", err);
    return res
      .status(500)
      .json({ error: "Error saving user in database. Try later" });
  }
};


// Generate a password reset token
const generatePasswordResetToken = async (email) => {
  const user = await User.findOne({ email });

  if (!user) {
    throw new Error("User not found");
  }

  const token = crypto.randomBytes(32).toString("hex"); // Generate a random token
  const expiration = Date.now() + 3600000; // Token expires in 1 hour

  const resetToken = new TokenModel({
    userId: user._id,
    token,
    expiration,
  });

  await resetToken.save();

  // Send the password reset email with a link like:
  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  const emailOptions = {
    from: "SnapURL@dturl.live",
    subject: "Password Reset for SnapURL",
    recipient: email,
    html: `Click <a href="${resetLink}">here</a> to reset your password.`,
  };

  await sendEmail(emailOptions);
};

// Add a new endpoint for handling password reset requests
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


// Add an endpoint for resetting the password
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    // Find the token in the database
    const resetToken = await TokenModel.findOne({ token });

    if (!resetToken || resetToken.expiration < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    // Update the user's password
    const user = await User.findById(resetToken.userId);
    user.password = password;
    await user.save();

    // Delete the used token
    await resetToken.remove();

    return res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};
