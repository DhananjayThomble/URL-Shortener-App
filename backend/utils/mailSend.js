import nodemailer from 'nodemailer';
import User from '../models/UserModel.js';
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
    const verifyEmailTemplate = fs.readFileSync(
      './views/welcome_email_template.ejs',
      'utf-8',
    );

    const dataToRender = {
      name: name,
    };

    const htmlTemplate = ejs.render(verifyEmailTemplate, dataToRender);

    const options = {
      from: 'SnapURL@dturl.live',
      subject: 'Welcome to SnapURL !!!',
      recipient: email,
      html: htmlTemplate,
    };

    await sendEmail(options);
  } catch (err) {
    console.error(err);
  }
};

// Function to send the verification email
export const sendVerificationEmail = async (email) => {
  try {
    console.log(email);
    const user = await User.findOne({ email });

    if (!user) {
      throw new Error('User not found');
    }

    const token = crypto.randomBytes(32).toString('hex'); // Generate a random token
    const expiration = Date.now() + 24 * 60 * 60 * 1000; // Token expires in 24 hours

    const verificationToken = new TokenModel({
      userId: user._id,
      token,
      expiration,
    });

    await verificationToken.save();

    const verificationLink = `http://localhost:4001/auth/verify-email?token=${token}`; // TODO:Replace this with frontend route
    const emailOptions = {
      from: 'SnapURL@dturl.live',
      subject: 'Email Verification for SnapURL',
      recipient: email,
      html: `Click <a href="${verificationLink}">here</a> to verify your email address.`,
    };

    await sendEmail(emailOptions);
  } catch (error) {
    console.error('Error sending verification email:', error);
  }
};
