import User from '../../models/UserModel.js';
import { sendWelcomeEmail } from '../../utils/mailSend.js';
import dotenv from 'dotenv';

dotenv.config();

export const signup = async (req, res) => {
  try {
    // all the fields are validated by the middleware in the route
    const { name, email, password } = req.body;
    // register the user in the database
    const user = new User({ name, email, password });

    await user.save();

    // send welcome email to the user
    await sendWelcomeEmail(name, email, user._id);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error saving user in database. Try later' });
  }
};
