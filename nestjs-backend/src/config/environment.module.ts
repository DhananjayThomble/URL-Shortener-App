import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnvironmentValidationService } from './environment-validation.service';
import { 
  developmentConfig, 
  stagingConfig, 
  productionConfig, 
  testConfig 
} from './environment-configs';

/**
 * Environment configuration factory
 */
export const environmentConfigFactory = () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  switch (nodeEnv) {
    case 'production':
      return productionConfig();
    case 'staging':
      return stagingConfig();
    case 'test':
      return testConfig();
    case 'development':
    default:
      return developmentConfig();
  }
};

/**
 * Environment validation factory
 */
export const environmentValidationFactory = (config: Record<string, unknown>) => {
  const validationService = new EnvironmentValidationService(
    new ConfigService(config)
  );
  
  // Validate the configuration
  const validatedConfig = validationService.validate(config);
  
  // Perform environment-specific validations
  validationService.validateProductionRequirements();
  
  // Log configuration summary
  validationService.logConfigurationSummary();
  
  return validatedConfig;
};

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env.local',
        '.env',
      ],
      load: [environmentConfigFactory],
      validate: environmentValidationFactory,
      expandVariables: true,
      cache: true,
    }),
  ],
  providers: [EnvironmentValidationService],
  exports: [EnvironmentValidationService],
})
export class EnvironmentModule {}