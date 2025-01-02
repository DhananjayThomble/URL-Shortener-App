import { Injectable } from '@nestjs/common';
import { MongooseModuleOptions, MongooseOptionsFactory } from '@nestjs/mongoose';
import { config } from 'dotenv';

config();

@Injectable()
export class DatabaseConfig implements MongooseOptionsFactory {
  createMongooseOptions(): MongooseModuleOptions {
    return {
      uri: process.env.DB_URL,
      useNewUrlParser: true,
      useUnifiedTopology: true,
    };
  }
}
