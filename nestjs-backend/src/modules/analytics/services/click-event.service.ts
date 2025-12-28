import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClickEvent, ClickEventDocument } from '../schemas/click-event.schema';
import { CreateClickEventDto } from '../dto/create-click-event.dto';
import { IClickEventService } from '../interfaces/click-event.interface';

@Injectable()
export class ClickEventService implements IClickEventService {
  private readonly logger = new Logger(ClickEventService.name);

  constructor(
    @InjectModel(ClickEvent.name)
    private readonly clickEventModel: Model<ClickEventDocument>,
  ) {}

  /**
   * Create a new click event record
   */
  async createClickEvent(createClickEventDto: CreateClickEventDto): Promise<ClickEvent> {
    try {
      const clickEvent = new this.clickEventModel({
        ...createClickEventDto,
        clickedAt: createClickEventDto.clickedAt || new Date(),
      });

      const savedEvent = await clickEvent.save();
      this.logger.log(`Click event created for link ${createClickEventDto.linkId}`);
      
      return savedEvent.toObject();
    } catch (error) {
      this.logger.error(`Failed to create click event: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get click events for a specific link
   */
  async getClickEventsByLink(
    linkId: string,
    limit: number = 100,
    offset: number = 0,
  ): Promise<ClickEvent[]> {
    try {
      const events = await this.clickEventModel
        .find({ linkId })
        .sort({ clickedAt: -1 })
        .limit(limit)
        .skip(offset)
        .lean()
        .exec();

      return events;
    } catch (error) {
      this.logger.error(`Failed to get click events for link ${linkId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get click events for a specific user
   */
  async getClickEventsByUser(
    userId: string,
    limit: number = 100,
    offset: number = 0,
  ): Promise<ClickEvent[]> {
    try {
      const events = await this.clickEventModel
        .find({ userId })
        .sort({ clickedAt: -1 })
        .limit(limit)
        .skip(offset)
        .lean()
        .exec();

      return events;
    } catch (error) {
      this.logger.error(`Failed to get click events for user ${userId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get click events within a date range
   */
  async getClickEventsByDateRange(
    startDate: Date,
    endDate: Date,
    linkId?: string,
    userId?: string,
  ): Promise<ClickEvent[]> {
    try {
      const query: any = {
        clickedAt: {
          $gte: startDate,
          $lte: endDate,
        },
      };

      if (linkId) {
        query.linkId = linkId;
      }

      if (userId) {
        query.userId = userId;
      }

      const events = await this.clickEventModel
        .find(query)
        .sort({ clickedAt: -1 })
        .lean()
        .exec();

      return events;
    } catch (error) {
      this.logger.error(`Failed to get click events by date range: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get total click count for a link
   */
  async getClickCountByLink(linkId: string): Promise<number> {
    try {
      const count = await this.clickEventModel.countDocuments({ linkId }).exec();
      return count;
    } catch (error) {
      this.logger.error(`Failed to get click count for link ${linkId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get unique click count for a link (based on IP hash)
   */
  async getUniqueClickCountByLink(linkId: string): Promise<number> {
    try {
      const uniqueIps = await this.clickEventModel
        .distinct('ipHash', { linkId })
        .exec();
      
      return uniqueIps.length;
    } catch (error) {
      this.logger.error(`Failed to get unique click count for link ${linkId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get click events grouped by country
   */
  async getClickEventsByCountry(linkId: string): Promise<{ country: string; count: number }[]> {
    try {
      const results = await this.clickEventModel
        .aggregate([
          { $match: { linkId, country: { $exists: true, $ne: null } } },
          {
            $group: {
              _id: '$country',
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              country: '$_id',
              count: 1,
            },
          },
          { $sort: { count: -1 } },
        ])
        .exec();

      return results;
    } catch (error) {
      this.logger.error(`Failed to get click events by country for link ${linkId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get click events grouped by device type
   */
  async getClickEventsByDevice(linkId: string): Promise<{ device: string; count: number }[]> {
    try {
      const results = await this.clickEventModel
        .aggregate([
          { $match: { linkId, device: { $exists: true, $ne: null } } },
          {
            $group: {
              _id: '$device',
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              device: '$_id',
              count: 1,
            },
          },
          { $sort: { count: -1 } },
        ])
        .exec();

      return results;
    } catch (error) {
      this.logger.error(`Failed to get click events by device for link ${linkId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get click events grouped by browser
   */
  async getClickEventsByBrowser(linkId: string): Promise<{ browser: string; count: number }[]> {
    try {
      const results = await this.clickEventModel
        .aggregate([
          { $match: { linkId, browser: { $exists: true, $ne: null } } },
          {
            $group: {
              _id: '$browser',
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              browser: '$_id',
              count: 1,
            },
          },
          { $sort: { count: -1 } },
        ])
        .exec();

      return results;
    } catch (error) {
      this.logger.error(`Failed to get click events by browser for link ${linkId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get recent click events
   */
  async getRecentClickEvents(limit: number = 50): Promise<ClickEvent[]> {
    try {
      const events = await this.clickEventModel
        .find()
        .sort({ clickedAt: -1 })
        .limit(limit)
        .lean()
        .exec();

      return events;
    } catch (error) {
      this.logger.error(`Failed to get recent click events: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Delete old click events (for data retention)
   */
  async deleteOldClickEvents(olderThan: Date): Promise<number> {
    try {
      const result = await this.clickEventModel
        .deleteMany({ clickedAt: { $lt: olderThan } })
        .exec();

      this.logger.log(`Deleted ${result.deletedCount} old click events`);
      return result.deletedCount;
    } catch (error) {
      this.logger.error(`Failed to delete old click events: ${error.message}`, error.stack);
      throw error;
    }
  }
}