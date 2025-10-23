import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';

@Injectable()
export class CustomValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    const object = plainToClass(metatype, value);
    const errors = await validate(object, {
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    if (errors.length > 0) {
      const formattedErrors = errors.map(error => ({
        field: error.property,
        value: error.value,
        constraints: error.constraints,
        messages: Object.values(error.constraints || {}),
      }));
      
      const errorMessages = errors.map(error => {
        const field = error.property;
        const messages = Object.values(error.constraints || {});
        return `${field}: ${messages.join(', ')}`;
      });
      
      throw new BadRequestException({
        message: 'Validation failed',
        errors: errorMessages,
        details: formattedErrors,
      });
    }

    return object;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}