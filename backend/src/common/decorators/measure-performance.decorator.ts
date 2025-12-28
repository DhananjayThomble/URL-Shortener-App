import { Logger } from '@nestjs/common';

export function MeasurePerformance(operationName?: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    const logger = new Logger(`${target.constructor.name}:${propertyName}`);
    
    descriptor.value = async function (...args: any[]) {
      const name = operationName || `${target.constructor.name}.${propertyName}`;
      const startTime = process.hrtime.bigint();
      
      try {
        const result = await method.apply(this, args);
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        
        if (duration > 100) { // Log operations taking more than 100ms
          logger.debug(`${name} completed in ${duration.toFixed(2)}ms`);
        }
        
        return result;
      } catch (error) {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000;
        
        logger.error(`${name} failed after ${duration.toFixed(2)}ms:`, error.message);
        throw error;
      }
    };
  };
}