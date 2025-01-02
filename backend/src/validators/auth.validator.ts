import { Injectable } from '@nestjs/common';
import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, registerDecorator, ValidationOptions } from 'class-validator';
import { User } from '../models/user.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@ValidatorConstraint({ async: true })
@Injectable()
export class IsEmailUnique implements ValidatorConstraintInterface {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  async validate(email: string, args: ValidationArguments) {
    const user = await this.userModel.findOne({ email });
    return !user;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Email $value is already in use.';
  }
}

export function IsEmailUniqueConstraint(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsEmailUnique,
    });
  };
}
