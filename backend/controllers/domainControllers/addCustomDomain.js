import { randomBytes } from 'crypto';
import CustomDomain from '../../models/CustomDomainsModel.js';
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

    const customDomain = await CustomDomain.create({
      url: domain,
      dnsVerificationCode,
      user: req.user,
    });

    // TODO: send email for verification process for the DNS
    user.customDomain = customDomain;
    await user.save();

    res.status(200).json({
      message:
        'Successfully added domain! Please refer to your email to verify it.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
