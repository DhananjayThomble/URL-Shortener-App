import dns from 'node:dns';

/**
 * Verifies DNS records for a given hostname against a verification code
 *
 * @param {String} hostname - hostname to check the verification against
 * @param {String} text - verification code for the domain
 * @returns Promise. The resolved object has the following structure:
 *          - status (boolean): Indicates if verification was successful
 *          - message (string): A message describing the verification status
 */
export const checkDNSTxtVerification = (hostname, text) => {
  return new Promise((resolve, reject) => {
    if (!hostname) {
      return reject(new Error('Please provide a hostname'));
    }

    dns.resolveTxt(hostname, (error, results) => {
      if (error) {
        return reject(error);
      }

      if (!results || results.length === 0) {
        reject({
          status: false,
          message: 'Verification code not present in the DNS records',
        });
      }

      let containsCode = false;

      results.forEach((result) => {
        if (result.includes(text)) {
          containsCode = true;
        }
      });

      if (containsCode) {
        resolve({ status: true, message: 'Verification successful' });
      }

      reject({
        status: false,
        message: 'Wrong verification code provided',
      });
    });
  });
};
