import User from "../models/UserModel.js";

import jwt from "jsonwebtoken";

import { check, validationResult } from "express-validator";

//-----------------------------------------------------Login--------------------------------------------------------------

export const validateLogin = [
  check("email").isEmail().withMessage("Email is required"),
  check("password").isLength({ min: 6 }).withMessage("Password is required"),
];

export const login = async (req, res) => {
  try {
    // validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, password } = req.body;

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
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

//-----------------------------------------------------Signup--------------------------------------------------------------
export const validateSignup = [
  check("name").isLength({ min: 3 }).withMessage("Name is required"),
  check("email").isEmail().withMessage("Email is required"),
  check("password").isLength({ min: 6 }).withMessage("Password is required"),
];

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
    if (!email || !EmailValidator.validate(email)) {
      return res
        .status(400)
        .json({ error: "Email is required and should be valid" });
    }

    // check if user already exists
    let userExist = await User.findOne({ email }).exec();
    if (userExist) return res.status(400).json({ error: "Email is taken" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }

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
};
