import jwt from "jsonwebtoken";
import User from "../../models/UserModel.js";
import dotenv from "dotenv";
import { isValidEmail } from "../../utils/helperfunc.js";
dotenv.config();

export const changeEmail = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const userId = decoded._id;

      try {
        // Retrieve the user from the database using the user ID
        const user = await User.findById(userId);

        if (!user) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        // Update the user's email
        user.email = newEmail;

        // Save the updated user
        await user.save();

        return res.status(200).json({ message: "Email updated successfully" });
      } catch (err) {
        console.log(err);
        return res.status(500).json({ error: "Failed to update email" });
      }
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
};
