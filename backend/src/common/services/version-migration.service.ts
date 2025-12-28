import { Injectable, Logger } from '@nestjs/common';

export interface VersionMigration {
  fromVersion: string;
  toVersion: string;
  transform: (data: any) => any;
  description: string;
}

export interface BackwardCompatibilityRule {
  version: string;
  fieldMappings: Record<string, string>;
  removedFields: string[];
  addedFields: Record<string, any>;
  customTransform?: (data: any) => any;
}

@Injectable()
export class VersionMigrationService {
  private readonly logger = new Logger(VersionMigrationService.name);

  private readonly migrations: VersionMigration[] = [
    // Example migration from v1 to v2
    {
      fromVersion: 'v1',
      toVersion: 'v2',
      description: 'Migrate link structure from v1 to v2',
      transform: (data: any) => {
        if (data.shortUrl) {
          // v1 used 'shortUrl', v2 uses 'shortCode'
          data.shortCode = data.shortUrl;
          delete data.shortUrl;
        }
        
        if (data.clicks !== undefined) {
          // v1 had simple click count, v2 has detailed analytics
          data.analytics = {
            totalClicks: data.clicks,
            uniqueClicks: data.clicks, // Approximate
            lastClickAt: data.lastAccessedAt || null,
          };
          delete data.clicks;
          delete data.lastAccessedAt;
        }

        // v2 introduced enhanced features
        if (!data.features) {
          data.features = {
            passwordProtected: !!data.password,
            geoTargeting: false,
            deviceTargeting: false,
            utmTracking: false,
          };
        }

        return data;
      },
    },
  ];

  private readonly backwardCompatibilityRules: BackwardCompatibilityRule[] = [
    // v2 to v1 backward compatibility
    {
      version: 'v1',
      fieldMappings: {
        shortCode: 'shortUrl',
        'analytics.totalClicks': 'clicks',
        'analytics.lastClickAt': 'lastAccessedAt',
      },
      removedFields: ['features', 'analytics.uniqueClicks'],
      addedFields: {},
      customTransform: (data: any) => {
        // Custom logic for complex transformations
        if (data.analytics) {
          data.clicks = data.analytics.totalClicks || 0;
          data.lastAccessedAt = data.analytics.lastClickAt;
        }
        return data;
      },
    },
  ];

  /**
   * Migrate data from one version to another
   */
  migrateData(data: any, fromVersion: string, toVersion: string): any {
    if (fromVersion === toVersion) {
      return data;
    }

    const migration = this.findMigration(fromVersion, toVersion);
    if (!migration) {
      this.logger.warn(
        `No migration found from ${fromVersion} to ${toVersion}`,
      );
      return data;
    }

    try {
      const migratedData = migration.transform(JSON.parse(JSON.stringify(data)));
      this.logger.debug(
        `Successfully migrated data from ${fromVersion} to ${toVersion}`,
      );
      return migratedData;
    } catch (error) {
      this.logger.error(
        `Failed to migrate data from ${fromVersion} to ${toVersion}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Apply backward compatibility transformations
   */
  applyBackwardCompatibility(data: any, targetVersion: string): any {
    const rule = this.backwardCompatibilityRules.find(
      (r) => r.version === targetVersion,
    );

    if (!rule) {
      return data;
    }

    try {
      let transformedData = JSON.parse(JSON.stringify(data));

      // Apply field mappings
      for (const [newField, oldField] of Object.entries(rule.fieldMappings)) {
        const value = this.getNestedValue(transformedData, newField);
        if (value !== undefined) {
          this.setNestedValue(transformedData, oldField, value);
        }
      }

      // Remove fields not supported in target version
      for (const field of rule.removedFields) {
        this.deleteNestedValue(transformedData, field);
      }

      // Add default values for fields expected in target version
      for (const [field, value] of Object.entries(rule.addedFields)) {
        if (this.getNestedValue(transformedData, field) === undefined) {
          this.setNestedValue(transformedData, field, value);
        }
      }

      // Apply custom transformation if provided
      if (rule.customTransform) {
        transformedData = rule.customTransform(transformedData);
      }

      return transformedData;
    } catch (error) {
      this.logger.error(
        `Failed to apply backward compatibility for version ${targetVersion}`,
        error,
      );
      return data;
    }
  }

  /**
   * Get supported migration paths
   */
  getSupportedMigrations(): VersionMigration[] {
    return this.migrations.map((m) => ({
      fromVersion: m.fromVersion,
      toVersion: m.toVersion,
      description: m.description,
      transform: undefined, // Don't expose the transform function
    }));
  }

  /**
   * Check if migration is available between versions
   */
  canMigrate(fromVersion: string, toVersion: string): boolean {
    return !!this.findMigration(fromVersion, toVersion);
  }

  /**
   * Get version compatibility information
   */
  getCompatibilityInfo(version: string): {
    supportedVersions: string[];
    backwardCompatible: string[];
    forwardCompatible: string[];
  } {
    const supportedVersions = ['v1', 'v2']; // This could be dynamic
    const backwardCompatible = this.backwardCompatibilityRules
      .filter((rule) => this.compareVersions(rule.version, version) < 0)
      .map((rule) => rule.version);
    const forwardCompatible = this.migrations
      .filter((m) => m.fromVersion === version)
      .map((m) => m.toVersion);

    return {
      supportedVersions,
      backwardCompatible,
      forwardCompatible,
    };
  }

  private findMigration(fromVersion: string, toVersion: string): VersionMigration | undefined {
    return this.migrations.find(
      (m) => m.fromVersion === fromVersion && m.toVersion === toVersion,
    );
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((current, key) => {
      if (!current[key]) current[key] = {};
      return current[key];
    }, obj);
    target[lastKey] = value;
  }

  private deleteNestedValue(obj: any, path: string): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((current, key) => current?.[key], obj);
    if (target) {
      delete target[lastKey];
    }
  }

  private compareVersions(version1: string, version2: string): number {
    const v1 = parseInt(version1.replace(/^v/, ''), 10);
    const v2 = parseInt(version2.replace(/^v/, ''), 10);
    return v1 - v2;
  }
}