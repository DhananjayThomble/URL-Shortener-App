import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CacheService } from '../../common/services/cache.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private cacheService: CacheService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const user = this.usersRepository.create(createUserDto);
    return this.usersRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({
      select: ['id', 'email', 'name', 'isEmailVerified', 'role', 'createdAt', 'updatedAt'],
    });
  }

  async findById(id: string): Promise<User> {
    // Try cache first
    const cacheKey = this.cacheService.generateUserCacheKey(id);
    const cachedUser = await this.cacheService.get<User>(cacheKey);
    
    if (cachedUser) {
      return cachedUser;
    }

    // Fallback to database
    const user = await this.usersRepository.findOne({
      where: { id },
      select: ['id', 'email', 'name', 'isEmailVerified', 'role', 'createdAt', 'updatedAt'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Cache the user data
    await this.cacheService.set(cacheKey, user, 1800); // 30 minutes TTL

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email },
      select: ['id', 'email', 'name', 'passwordHash', 'isEmailVerified', 'role', 'createdAt', 'updatedAt'],
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);
    
    Object.assign(user, updateUserDto);
    const updatedUser = await this.usersRepository.save(user);

    // Update cache with new user data
    const cacheKey = this.cacheService.generateUserCacheKey(id);
    await this.cacheService.set(cacheKey, updatedUser, 1800); // 30 minutes TTL

    // Also invalidate user session cache to force refresh
    await this.cacheService.invalidateUserSession(id);

    return updatedUser;
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    await this.usersRepository.remove(user);

    // Clear all user-related cache data
    await this.cacheService.invalidateUserCache(id);
  }

  async verifyEmail(id: string): Promise<User> {
    const user = await this.findById(id);
    user.isEmailVerified = true;
    const updatedUser = await this.usersRepository.save(user);

    // Update cache with verified user data
    const cacheKey = this.cacheService.generateUserCacheKey(id);
    await this.cacheService.set(cacheKey, updatedUser, 1800); // 30 minutes TTL

    // Also invalidate user session cache to force refresh
    await this.cacheService.invalidateUserSession(id);

    return updatedUser;
  }

  async count(): Promise<number> {
    return this.usersRepository.count();
  }
}