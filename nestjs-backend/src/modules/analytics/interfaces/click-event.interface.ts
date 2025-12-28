import { ClickEvent } from '../schemas/click-event.schema';
import { CreateClickEventDto } from '../dto/create-click-event.dto';

export interface IClickEventService {
  /**
   * Create a new click event record
   */
  createClickEvent(createClickEventDto: CreateClickEventDto): Promise<ClickEvent>;

  /**
   * Get click events for a specific link
   */
  getClickEventsByLink(linkId: string, limit?: number, offset?: number): Promise<ClickEvent[]>;

  /**
   * Get click events for a specific user
   */
  getClickEventsByUser(userId: string, limit?: number, offset?: number): Promise<ClickEvent[]>;

  /**
   * Get click events within a date range
   */
  getClickEventsByDateRange(
    startDate: Date,
    endDate: Date,
    linkId?: string,
    userId?: string
  ): Promise<ClickEvent[]>;

  /**
   * Get total click count for a link
   */
  getClickCountByLink(linkId: string): Promise<number>;

  /**
   * Get unique click count for a link (based on IP hash)
   */
  getUniqueClickCountByLink(linkId: string): Promise<number>;

  /**
   * Get click events grouped by country
   */
  getClickEventsByCountry(linkId: string): Promise<{ country: string; count: number }[]>;

  /**
   * Get click events grouped by device type
   */
  getClickEventsByDevice(linkId: string): Promise<{ device: string; count: number }[]>;

  /**
   * Get click events grouped by browser
   */
  getClickEventsByBrowser(linkId: string): Promise<{ browser: string; count: number }[]>;

  /**
   * Get recent click events
   */
  getRecentClickEvents(limit?: number): Promise<ClickEvent[]>;

  /**
   * Delete old click events (for data retention)
   */
  deleteOldClickEvents(olderThan: Date): Promise<number>;
}