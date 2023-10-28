import User from '../../models/UserModel.js';
import { checkDNSTxtVerification } from '../../utils/dns.js';

// Checks if domain added by user belongs to them
// Uses DNS text record to verify domain
export const verifyCustomDomain = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+customDomain');

    if (!user) {
      res.send('User does not exist');
      return;
    }

    if (user.customDomain.isVerified) {
      return res.status().json({
        message: 'Domain already verified',
      });
    }

    if (!user.customDomain.url || !user.customDomain.dnsVerificationCode) {
      console.error(`Invalid data present for the user ${user._id}`);

      return res.status(200).json({
        message: 'Sorry, something went wrong! Please try again',
      });
    }

    const domainVerification = await checkDNSTxtVerification(
      // This URL might need change
      `_verification.${user.customDomain.url}`,
      user.customDomain.dnsVerificationCode,
    );

    if (!domainVerification.status) {
      return res.status(422).json({
        status: false,
        message: domainVerification.message,
      });
    }

    res.status(200).json({
      message: 'Successfully verified domain',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
