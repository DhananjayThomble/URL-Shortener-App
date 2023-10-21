import jwt from 'jsonwebtoken';
import User from "../../models/UserModel.js";
import dotenv from "dotenv";
dotenv.config();

export const changeEamil = async (req, res) => {
  try {
    const token = req.headers.authorization;
    
    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
  
      // The decoded object contains the user's information
      const userId = decoded._id;
  
      // Retrieve the user from the database using the user ID
      await User.findById(userId, async (err, user) => {
        if (err || !user) {
          return res.status(401).json({ message: 'Unauthorized' });
        }
  
        const newEmail = req.body.email;
  
        // Update the user's email
        user.email = newEmail;
  
        // Save the updated user
        await user.save((err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to update email' });
          }
  
          return res.status(200).json({ message: 'Email updated successfully' });
        });
      });
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Server error' });
  }
};
