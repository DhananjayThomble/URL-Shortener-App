import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Admin } from '../models/admin.model';
import { Token } from '../models/token.model';
import { Feedback } from '../models/feedback.model';
import { CreateAdminDto, LoginAdminDto, ForgotPasswordDto, ResetPasswordDto } from '../dtos/admin.dto';
import { JwtService } from '@nestjs/jwt';
import { MailUtil } from '../utils/mail.util';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Admin.name) private readonly adminModel: Model<Admin>,
    @InjectModel(Token.name) private readonly tokenModel: Model<Token>,
    @InjectModel(Feedback.name) private readonly feedbackModel: Model<Feedback>,
    private readonly jwtService: JwtService,
    private readonly mailUtil: MailUtil,
  ) {}

  async signup(createAdminDto: CreateAdminDto): Promise<Admin> {
    const { email, password } = createAdminDto;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = new this.adminModel({ ...createAdminDto, password: hashedPassword });
    return newAdmin.save();
  }

  async login(loginAdminDto: LoginAdminDto): Promise<{ accessToken: string }> {
    const { email, password } = loginAdminDto;
    const admin = await this.adminModel.findOne({ email });
    if (!admin || !(await bcrypt.compare(password, admin.password))) {
      throw new NotFoundException('Invalid credentials');
    }
    const payload = { email: admin.email, sub: admin._id };
    const accessToken = this.jwtService.sign(payload);
    return { accessToken };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<void> {
    const { email } = forgotPasswordDto;
    const admin = await this.adminModel.findOne({ email });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiration = Date.now() + 3600000;
    const resetToken = new this.tokenModel({ userId: admin._id, token, expiration });
    await resetToken.save();
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await this.mailUtil.sendMail(email, 'Password Reset for SnapURL', `Click <a href="${resetLink}">here</a> to reset your password.`);
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    const { token, newPassword } = resetPasswordDto;
    const resetToken = await this.tokenModel.findOne({ token });
    if (!resetToken || resetToken.expiration < Date.now()) {
      throw new NotFoundException('Invalid or expired token');
    }
    const admin = await this.adminModel.findById(resetToken.userId);
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();
    await resetToken.remove();
  }

  async getReviews(): Promise<Feedback[]> {
    return this.feedbackModel.find().exec();
  }

  async deleteReview(id: string): Promise<void> {
    const result = await this.feedbackModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Review not found');
    }
  }

  async deleteAllReviews(): Promise<void> {
    await this.feedbackModel.deleteMany().exec();
  }
}
