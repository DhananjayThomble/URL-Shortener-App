import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';
import * as session from 'express-session';
import * as passport from 'passport';
import * as rateLimit from 'express-rate-limit';
import * as cors from 'cors';
import * as winston from 'winston';
import * as WinstonCloudWatch from 'winston-cloudwatch';
import { config } from 'dotenv';
import { initCustomDomainJobs } from './jobs/customDomainJobs';

config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe());

  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      cookie: {},
      resave: false,
      saveUninitialized: true,
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  app.set('trust proxy', 2);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('URL Shortener API')
    .setDescription('API documentation for URL Shortener')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('doc', app, document);

  const limiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 30, // limit each IP to 30 requests per windowMs
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    keyGenerator: function (req) {
      return req.headers['x-forwarded-for'] || req.ip; // for nginx proxy server
    },
  });

  app.use(limiter);

  const isProduction = process.env.NODE_ENV === 'production';
  const corsOptions = {
    origin: function (origin, callback) {
      if (isProduction) {
        if (origin && /\.snapurl\.in$/.test(origin)) {
          callback(null, true);
        } else {
          callback(
            new Error('Only requests from snapurl.in subdomains are allowed.'),
          );
        }
      } else {
        callback(null, true);
      }
    },
    optionsSuccessStatus: 200,
  };

  app.use(cors(corsOptions));

  app.useGlobalFilters(new GlobalErrorHandler());

  const logger = winston.createLogger({
    transports: [
      isProduction
        ? new WinstonCloudWatch({
            logGroupName: 'snapurl',
            logStreamName: 'nest-server',
            awsRegion: 'ap-south-1',
            jsonMessage: true,
            awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
            awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          })
        : new winston.transports.Console({
            format: winston.format.simple(),
          }),
    ],
  });

  logger.level = 'debug';
  logger.on('error', (err) => {
    console.error('Error in Winston CloudWatch logger:', err);
  });

  console.log = function (...args) {
    logger.info(args.join(' '));
  };

  console.error = function (...args) {
    logger.error(args.join(' '));
  };

  initCustomDomainJobs();

  await app.listen(process.env.PORT || 3000);
}

bootstrap();
