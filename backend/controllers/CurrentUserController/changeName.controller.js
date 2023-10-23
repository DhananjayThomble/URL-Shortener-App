import jwt from "jsonwebtoken";
import User from "../../models/UserModel.js";
import dotenv from "dotenv";
dotenv.config();

export const changeName = async (req, res) => {
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

        const newName = req.body.name;

        // Update the user's name
        user.name = newName;

        // Save the updated user
        await user.save();

        return res.status(200).json({ message: "Name updated successfully" });
      } catch (err) {
        console.log(err);
        return res.status(500).json({ error: "Failed to update Name" });
      }
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
};
