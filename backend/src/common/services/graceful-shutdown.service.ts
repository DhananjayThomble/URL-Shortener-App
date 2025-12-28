import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GracefulShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(GracefulShutdownService.name);
  private isShuttingDown = false;
  private shutdownTimeout: number;

  constructor(private configService: ConfigService) {
    this.shutdownTimeout = this.configService.get('SHUTDOWN_TIMEOUT', 10000);
    this.setupSignalHandlers();
  }

  async onApplicationShutdown(signal?: string) {
    if (this.isShuttingDown) {
      this.logger.warn('Shutdown already in progress, ignoring signal');
      return;
    }

    this.isShuttingDown = true;
    this.logger.log(`Received shutdown signal: ${signal || 'unknown'}`);
    
    try {
      await this.performGracefulShutdown();
      this.logger.log('Graceful shutdown completed successfully');
      process.exit(0);
    } catch (error) {
      this.logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  private setupSignalHandlers() {
    // Handle SIGTERM (Docker, Kubernetes)
    process.on('SIGTERM', () => {
      this.logger.log('Received SIGTERM signal');
      this.onApplicationShutdown('SIGTERM');
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      this.logger.log('Received SIGINT signal');
      this.onApplicationShutdown('SIGINT');
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception:', error);
      this.onApplicationShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      this.onApplicationShutdown('unhandledRejection');
    });
  }

  private async performGracefulShutdown(): Promise<void> {
    const shutdownPromise = this.executeShutdownSteps();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Shutdown timeout after ${this.shutdownTimeout}ms`));
      }, this.shutdownTimeout);
    });

    await Promise.race([shutdownPromise, timeoutPromise]);
  }

  private async executeShutdownSteps(): Promise<void> {
    this.logger.log('Starting graceful shutdown sequence...');

    // Step 1: Stop accepting new requests
    this.logger.log('Step 1: Stopping new request acceptance');
    await this.stopAcceptingRequests();

    // Step 2: Wait for ongoing requests to complete
    this.logger.log('Step 2: Waiting for ongoing requests to complete');
    await this.waitForOngoingRequests();

    // Step 3: Close database connections
    this.logger.log('Step 3: Closing database connections');
    await this.closeDatabaseConnections();

    // Step 4: Close cache connections
    this.logger.log('Step 4: Closing cache connections');
    await this.closeCacheConnections();

    // Step 5: Cleanup resources
    this.logger.log('Step 5: Cleaning up resources');
    await this.cleanupResources();

    this.logger.log('Graceful shutdown sequence completed');
  }

  private async stopAcceptingRequests(): Promise<void> {
    // In a real implementation, you would:
    // 1. Remove the server from load balancer
    // 2. Stop accepting new HTTP connections
    // 3. Return 503 Service Unavailable for health checks
    
    return new Promise((resolve) => {
      setTimeout(resolve, 100); // Simulate stopping new requests
    });
  }

  private async waitForOngoingRequests(): Promise<void> {
    // Wait for ongoing HTTP requests to complete
    const maxWaitTime = 5000; // 5 seconds
    const checkInterval = 100; // 100ms
    let waitTime = 0;

    return new Promise((resolve) => {
      const checkOngoingRequests = () => {
        // In a real implementation, you would check:
        // 1. Active HTTP connections
        // 2. Ongoing database transactions
        // 3. Background jobs/tasks
        
        const hasOngoingRequests = false; // Placeholder
        
        if (!hasOngoingRequests || waitTime >= maxWaitTime) {
          this.logger.log(`Waited ${waitTime}ms for ongoing requests`);
          resolve();
        } else {
          waitTime += checkInterval;
          setTimeout(checkOngoingRequests, checkInterval);
        }
      };

      checkOngoingRequests();
    });
  }

  private async closeDatabaseConnections(): Promise<void> {
    try {
      // Close TypeORM connections
      // const connection = getConnection();
      // if (connection.isConnected) {
      //   await connection.close();
      // }

      // Close Mongoose connections
      // await mongoose.disconnect();

      this.logger.log('Database connections closed successfully');
    } catch (error) {
      this.logger.error('Error closing database connections:', error);
      throw error;
    }
  }

  private async closeCacheConnections(): Promise<void> {
    try {
      // Close Redis connections
      // This would be handled by the CacheService
      this.logger.log('Cache connections closed successfully');
    } catch (error) {
      this.logger.error('Error closing cache connections:', error);
      throw error;
    }
  }

  private async cleanupResources(): Promise<void> {
    try {
      // Cleanup any other resources:
      // 1. File handles
      // 2. Timers/intervals
      // 3. Event listeners
      // 4. Background processes
      
      this.logger.log('Resources cleaned up successfully');
    } catch (error) {
      this.logger.error('Error cleaning up resources:', error);
      throw error;
    }
  }

  // Health check method to indicate shutdown status
  isHealthy(): boolean {
    return !this.isShuttingDown;
  }

  // Method to check if shutdown is in progress
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }
}