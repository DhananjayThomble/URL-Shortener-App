import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-headerapikey';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor(private configService: ConfigService) {
    super(
      { header: 'X-API-Key', prefix: '' },
      true,
      (apiKey: string, done: any) => {
        return this.validate(apiKey, done);
      },
    );
  }

  private validate(apiKey: string, done: any) {
    // In production, you would validate against a database of API keys
    const validApiKeys = this.configService.get('VALID_API_KEYS', '').split(',');
    
    if (validApiKeys.includes(apiKey)) {
      return done(null, { apiKey, type: 'api-key' });
    }
    
    return done(new UnauthorizedException('Invalid API key'), null);
  }
}