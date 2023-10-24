import jwt from 'jsonwebtoken';
import User from '../../models/UserModel.js';
import dotenv from 'dotenv';
dotenv.config();

export const getCurrentUser = (req, res) => {
  // Check if a token is present in the request headers
  // split the token from the "Bearer" string
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  // Verify and decode the token
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // The decoded object contains the user's information
    const userId = decoded._id;

    // Retrieve the user from the database using the user ID
    User.findById(userId, (err, user) => {
      if (err || !user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      // Send the user's information in the response
      return res.status(200).json({ user });
    });
  });
};
