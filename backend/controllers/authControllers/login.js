import User from '../../models/UserModel.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const login = async (req, res) => {
  try {
    // get email and password from request body
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    // if user not found, 401 status for unauthorized
    if (!user) return res.status(401).json({ error: 'Email does not exist' });

    // check password using passport
    user.comparePassword(password, (err, isMatch) => {
      if (!isMatch)
        return res.status(401).json({ error: 'Invalid credentials' });

      // password matched, create a token
      const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
        expiresIn: '7d',
      });

      // send token in response
      const { _id, name, email } = user;
      return res.status(200).json({ token, user: { _id, name, email } });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
