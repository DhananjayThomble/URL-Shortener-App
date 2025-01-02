import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { config } from 'dotenv';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as ejs from 'ejs';
import { TokenModel } from '../models/Tokenmodel';

config();

@Injectable()
export class MailUtil {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT, 10),
      secure: true,
      requireTLS: true,
      auth: {
        user: process.env.EMAIL_HOST_USER,
        pass: process.env.EMAIL_HOST_PASSWORD,
      },
    });
  }

  async sendEmail(options: { from: string; subject: string; recipient: string; html: string }) {
    return new Promise((resolve, reject) => {
      try {
        const mailOptions = {
          from: options.from,
          to: options.recipient,
          subject: options.subject,
          html: options.html,
        };

        this.transporter.sendMail(mailOptions, (error, info) => {
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
  }

  async sendWelcomeEmail(name: string, email: string, userID: string) {
    try {
      console.log('Sending welcome email to', email);
      const verifyEmailTemplate = fs.readFileSync('./views/welcome_email_template.ejs', 'utf-8');

      const dataToRender = {
        name: name,
        verificationLink: await this.getVerificationLink(userID),
      };

      const htmlTemplate = ejs.render(verifyEmailTemplate, dataToRender);

      const options = {
        from: 'SnapURL@snapurl.in',
        subject: 'Welcome to SnapURL🔗',
        recipient: email,
        html: htmlTemplate,
      };

      await this.sendEmail(options);
    } catch (err) {
      console.log('Error sending welcome email to', email);
      console.error(err);
    }
  }

  private async getVerificationLink(userId: string) {
    try {
      const token = crypto.randomBytes(32).toString('hex'); // Generate a random token
      const expiration = Date.now() + 24 * 60 * 60 * 1000; // Token expires in 24 hours

      const verificationToken = new TokenModel({
        userId,
        token,
        expiration,
      });

      await verificationToken.save();

      const verificationLink = `${process.env.BASE_URL}/auth/verify-email?token=${token}`;
      return verificationLink;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  async sendPasswordResetEmail(email: string, resetLink: string) {
    try {
      const resetPasswordTemplate = fs.readFileSync('./views/reset_password_email_template.ejs', 'utf-8');

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

      await this.sendEmail(options);
    } catch (err) {
      console.log('Error sending password reset email to', email);
      console.error(err);
    }
  }
}
