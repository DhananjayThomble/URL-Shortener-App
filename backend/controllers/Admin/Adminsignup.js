import Admin from "../../models/AdminModel.js";
import { sendVerificationEmail, sendWelcomeEmail } from "../../utils/mailSend.js";
import dotenv from "dotenv";
dotenv.config();

export const Adminsignup = async (req, res) => {
    try {

      // get name and pasword fields from request body
      const { name, password } = req.body;

      
      // Validate that name is at least three characters long
      if (!name || name.length < 3)
      return res.status(400).json({
        error: "Name is required and should be at least 3 characters long",
      });

     
      // Validate that password is at least six characters long
      if (!password || password.length < 6)
      return res.status(400).json({
        error: "Password is required and should be at least 6 characters long",
      });


    // register the user in the database
    const user = new Admin(req.body);

    await user.save();
    console.log("User saved");


    // Sending the welcome email
    await sendVerificationEmail(user.email);
    await sendWelcomeEmail(user.name, user.email);
    

    return res.status(200).json({ ok: true });

  } catch(err){
    console.log("CREATE USER FAILED", err);
    return res
      .status(500)
      .json({ error: "Error saving user in database. Try later" });
  }
};
  