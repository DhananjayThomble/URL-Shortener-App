import express from "express";
import User from "../models/UserModel.js";
import jwt from "jsonwebtoken";
import * as EmailValidator from "email-validator";

const router = express.Router();

/*
 * login route: ip/api/v2/auth/login
 * signup route: ip/api/v2/auth/signup
 * */
export function isApiAuthenticated(req, res, next) {
  //  check if token is present in headers
  if (!req.headers.authorization) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  // verify the token
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      res.status(401).json({ message: "Invalid token" });
    } else {
      req.user = decoded;
      next();
    }
  });
}

// ------------------ AUTHENTICATION ------------------
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  // check email and password is present
  if (!email || !password)
    return res.status(400).json({ error: "Email and password is required" });

  if (!EmailValidator.validate(email)) {
    return res.status(400).json({ error: "Email is not valid" });
  }
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password should be min 6 characters long" });
  }

  const user = await User.findOne({ email });
  // if user not found, 401 status for unauthorized
  if (!user) return res.status(401).json({ error: "Invalid email" });
  // check password using passport
  user.comparePassword(password, (err, isMatch) => {
    if (!isMatch) return res.status(401).json({ error: "Invalid password" });

    // password matched, create a token
    const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    // send token in response
    const { _id, name, email } = user;
    return res.status(200).json({ token, user: { _id, name, email } });
  });
});

router.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || name.length < 3)
    return res
      .status(400)
      .json({ error: "Name is required and should be min 3 characters long" });
  if (!password || password.length < 6)
    return res.status(400).json({
      error: "Password is required and should be min 6 characters long",
    });
  if (!email || !EmailValidator.validate(email)) {
    return res
      .status(400)
      .json({ error: "Email is required and should be valid" });
  }

  // check if user already exists
  let userExist = await User.findOne({ email }).exec();
  if (userExist) return res.status(400).json({ error: "Email is taken" });

  // register
  const user = new User(req.body);
  try {
    await user.save();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.log("CREATE USER FAILED", err);
    return res
      .status(500)
      .json({ error: "Error saving user in database. Try later" });
  }
});

export default router;
