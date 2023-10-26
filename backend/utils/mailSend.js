import nodemailer from 'nodemailer';
import TokenModel from '../models/Tokenmodel.js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import ejs from 'ejs';
dotenv.config();

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

// <--------------------Sending email to the user ----------------------------------->

export const sendWelcomeEmail = async (name, email, userID) => {
  try {
    console.log('Sending welcome email to', email);
    const verifyEmailTemplate = fs.readFileSync(
      './views/welcome_email_template.ejs',
      'utf-8',
    );

    const dataToRender = {
      name: name,
      verificationLink: await getVerificationLink(userID),
    };

    const htmlTemplate = ejs.render(verifyEmailTemplate, dataToRender);

    const options = {
      from: 'SnapURL@snapurl.in',
      subject: 'Welcome to SnapURL🔗',
      recipient: email,
      html: htmlTemplate,
    };

    await sendEmail(options);
  } catch (err) {
    console.log('Error sending welcome email to', email);
    console.error(err);
  }
};

const getVerificationLink = async (userId) => {
  try {
    const token = crypto.randomBytes(32).toString('hex'); // Generate a random token
    const expiration = Date.now() + 24 * 60 * 60 * 1000; // Token expires in 24 hours

    const verificationToken = new TokenModel({
      userId,
      token,
      expiration,
    });

    await verificationToken.save();

    // const verificationLink = `http://localhost:4001/auth/verify-email?token=${token}`;
    const verificationLink = `${process.env.BASE_URL}/auth/verify-email?token=${token}`;
    return verificationLink;
  } catch (error) {
    console.error(error);
    return null;
  }
};

export const sendPasswordResetEmail = async (email, resetLink) => {
  try {
    const resetPasswordTemplate = fs.readFileSync(
      './views/reset_password_email_template.ejs',
      'utf-8',
    );

    const dataToRender = {
      resetLink: resetLink,
    };

    const htmlTemplate = ejs.render(resetPasswordTemplate, dataToRender);

    const options = {
      from: 'SnapURL@snapurl.in',
      subject: 'Reset your SnapURL password',
      recipient: email,
      html: htmlTemplate,
    };

    await sendEmail(options);
  } catch (err) {
    console.log('Error sending password reset email to', email);
    console.error(err);
  }
};
