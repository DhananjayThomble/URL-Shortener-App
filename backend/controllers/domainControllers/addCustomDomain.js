import { randomBytes } from 'crypto';
import User from '../../models/UserModel.js';

export const addCustomDomain = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      res.send('User does not exist');
      return;
    }

    const { domain } = req.body;

    if (!domain) {
      res.send('Please provide a domain');
      return;
    }

    const dnsVerificationCode = randomBytes(32).toString('hex');

    user.customDomain = {
      url: domain,
      dnsVerificationCode,
    };

    await user.save();

    // TODO: send email for verification process for the DNS

    res.status(200).json({
      message:
        'Successfully added domain! Please refer to your email to verify it.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
