import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../models/user.model';
import { Token } from '../models/token.model';
import { LoginDto, SignupDto, ForgotPasswordDto, ResetPasswordDto, VerifyEmailDto, ChangeEmailDto, ChangeNameDto } from '../dtos/auth.dto';
import { sendEmail, sendWelcomeEmail, sendPasswordResetEmail } from '../utils/mail.util';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Token.name) private readonly tokenModel: Model<Token>,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;
    const user = await this.userModel.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { email: user.email, sub: user._id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async signup(signupDto: SignupDto) {
    const { name, email, password } = signupDto;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new this.userModel({ name, email, password: hashedPassword });
    await user.save();

    await sendWelcomeEmail(name, email, user._id);

    const payload = { email: user.email, sub: user._id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;
    const user = await this.userModel.findOne({ email });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const token = await this.generatePasswordResetToken(user._id);
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await sendPasswordResetEmail(email, resetLink);
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token, newPassword } = resetPasswordDto;
    const resetToken = await this.tokenModel.findOne({ token });

    if (!resetToken || resetToken.expiration < Date.now()) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userModel.findByIdAndUpdate(resetToken.userId, { password: hashedPassword });
    await this.tokenModel.deleteOne({ token });
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto) {
    const { token } = verifyEmailDto;
    const verificationToken = await this.tokenModel.findOne({ token });

    if (!verificationToken || verificationToken.expiration < Date.now()) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    await this.userModel.findByIdAndUpdate(verificationToken.userId, { isVerified: true });
    await this.tokenModel.deleteOne({ token });
  }

  async getCurrentUser(user: any) {
    return this.userModel.findById(user.sub).select('-password');
  }

  async changeEmail(changeEmailDto: ChangeEmailDto) {
    const { userId, newEmail } = changeEmailDto;
    await this.userModel.findByIdAndUpdate(userId, { email: newEmail });
  }

  async changeName(changeNameDto: ChangeNameDto) {
    const { userId, newName } = changeNameDto;
    await this.userModel.findByIdAndUpdate(userId, { name: newName });
  }

  private async generatePasswordResetToken(userId: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiration = Date.now() + 3600000;

    const resetToken = new this.tokenModel({
      userId,
      token,
      expiration,
    });

    await resetToken.save();
    return token;
  }
}
