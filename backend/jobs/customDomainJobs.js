import cron from 'node-cron';
import CustomDomain from '../models/CustomDomainsModel.js';
import { checkDNSTxtVerification } from '../utils/dns.js';

const fetchAndVerifyDomains = () => {
  (async () => {
    try {
      const domains = await CustomDomain.find({ isVerified: { $eq: false } });

      for (let i = 0; i < domains.length; i++) {
        const domain = domains[i];

        const domainVerification = await checkDNSTxtVerification(
          domain.url,
          domain.dnsVerificationCode,
        );

        if (domainVerification.status === true) {
          // send mail to inform domain verification is successful
          domain.isVerified = true;
          domain.save();
        }
      }
    } catch (error) {
      if (error.message) {
        console.error(error);
      }
    }
  })();
};

const initCustomDomainJobs = () => {
  cron.schedule('0 * * * *', fetchAndVerifyDomains);
};

export default initCustomDomainJobs;
