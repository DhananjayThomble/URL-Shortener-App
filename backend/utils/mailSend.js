import nodemailer from "nodemailer"
import dotenv from "dotenv"
dotenv.config()

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true,
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_HOST_USER,
    pass: process.env.EMAIL_HOST_PASSWORD,
  },
});


export const sendEmail = async (options) => {
  return new Promise((resolve, reject) => {
    try {
      const subject = options.subject;
      const recipient = options.recipient;
      const html = options.html;

      const mailOptions = {
        from: options.from,
        to: recipient,
        subject: subject,
        html: html,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error(`Error from mailSender ${error}`);
          reject(error);
        } else {
          console.log(`Email sent: ${info.response}`);
          resolve(info);
        }
      });
    } catch (error) {
      console.error(`Error from mailSender ${error}`);
      reject(error);
    }
  });
};
