/**
 * Property-Based Test: Test Database Isolation and Cleanup
 * Feature: comprehensive-backend-testing, Property 2: Test Isolation and Cleanup
 * Validates: Requirements 8.1, 8.3, 8.4
 */

import * as fc from 'fast-check';
import { TestDatabaseManager } from '../utils/test-database-manager';
import { User } from '../../src/modules/users/entities/user.entity';
import { Link } from '../../src/modules/urls/entities/link.entity';
import { BioPage } from '../../src/modules/bio-pages/entities/bio-page.entity';

describe('Property Test: Test Database Isolation and Cleanup', () => {
  let dbManager1: TestDatabaseManager;
  let dbManager2: TestDatabaseManager;

  beforeAll(async () => {
    // Create two separate database managers for isolation testing
    dbManager1 = new TestDatabaseManager({
      isolationLevel: 'transaction',
      autoCleanup: true,
      seedData: false,
      parallelSafe: true,
    });

    dbManager2 = new TestDatabaseManager({
      isolationLevel: 'transaction',
      autoCleanup: true,
      seedData: false,
      parallelSafe: true,
    });

    await dbManager1.setupTestDatabase();
    await dbManager2.setupTestDatabase();
  });

  afterAll(async () => {
    await dbManager1.teardownTestDatabase();
    await dbManager2.teardownTestDatabase();
  });

  /**
   * Property: Test isolation ensures no data leakage between test instances
   * For any set of test data operations, each test database manager should
   * maintain complete isolation from other instances
   */
  it('should maintain complete isolation between test database instances', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate test data for both database instances
        fc.record({
          users1: fc.array(fc.record({
            email: fc.emailAddress(),
            name: fc.string({ minLength: 2, maxLength: 50 }),
          }), { minLength: 1, maxLength: 5 }),
          users2: fc.array(fc.record({
            email: fc.emailAddress(),
            name: fc.string({ minLength: 2, maxLength: 50 }),
          }), { minLength: 1, maxLength: 5 }),
          links1: fc.array(fc.record({
            originalUrl: fc.webUrl(),
            shortCode: fc.string({ minLength: 6, maxLength: 12 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
            title: fc.string({ minLength: 1, maxLength: 100 }),
          }), { minLength: 0, maxLength: 3 }),
          links2: fc.array(fc.record({
            originalUrl: fc.webUrl(),
            shortCode: fc.string({ minLength: 6, maxLength: 12 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
            title: fc.string({ minLength: 1, maxLength: 100 }),
          }), { minLength: 0, maxLength: 3 }),
        }),
        async (testData) => {
          // Clear both databases to start fresh
          await dbManager1.clearDatabase();
          await dbManager2.clearDatabase();

          // Create users in database 1
          const createdUsers1: User[] = [];
          for (const userData of testData.users1) {
            const user = await dbManager1.createTestUser(userData);
            createdUsers1.push(user);
          }

          // Create users in database 2
          const createdUsers2: User[] = [];
          for (const userData of testData.users2) {
            const user = await dbManager2.createTestUser(userData);
            createdUsers2.push(user);
          }

          // Create links in database 1
          const createdLinks1: Link[] = [];
          for (let i = 0; i < testData.links1.length && i < createdUsers1.length; i++) {
            const link = await dbManager1.createTestUrl(createdUsers1[i].id, testData.links1[i]);
            createdLinks1.push(link);
          }

          // Create links in database 2
          const createdLinks2: Link[] = [];
          for (let i = 0; i < testData.links2.length && i < createdUsers2.length; i++) {
            const link = await dbManager2.createTestUrl(createdUsers2[i].id, testData.links2[i]);
            createdLinks2.push(link);
          }

          // Verify isolation: Database 1 should only see its own data
          const userRepo1 = dbManager1.getRepository(User);
          const linkRepo1 = dbManager1.getRepository(Link);
          
          const db1Users = await userRepo1.find();
          const db1Links = await linkRepo1.find();

          // Database 1 should have exactly the users and links we created for it
          expect(db1Users).toHaveLength(testData.users1.length);
          expect(db1Links).toHaveLength(testData.links1.length);

          // Verify isolation: Database 2 should only see its own data
          const userRepo2 = dbManager2.getRepository(User);
          const linkRepo2 = dbManager2.getRepository(Link);
          
          const db2Users = await userRepo2.find();
          const db2Links = await linkRepo2.find();

          // Database 2 should have exactly the users and links we created for it
          expect(db2Users).toHaveLength(testData.users2.length);
          expect(db2Links).toHaveLength(testData.links2.length);

          // Verify no cross-contamination: IDs should be completely different
          const db1UserIds = new Set(db1Users.map(u => u.id));
          const db2UserIds = new Set(db2Users.map(u => u.id));
          const db1LinkIds = new Set(db1Links.map(l => l.id));
          const db2LinkIds = new Set(db2Links.map(l => l.id));

          // No user IDs should overlap between databases
          const userIdIntersection = new Set([...db1UserIds].filter(id => db2UserIds.has(id)));
          expect(userIdIntersection.size).toBe(0);

          // No link IDs should overlap between databases
          const linkIdIntersection = new Set([...db1LinkIds].filter(id => db2LinkIds.has(id)));
          expect(linkIdIntersection.size).toBe(0);
        }
      ),
      { numRuns: 100, timeout: 30000 }
    );
  });

  /**
   * Property: Database cleanup should completely remove all test data
   * For any test data created, calling clearDatabase should result in
   * an empty database state
   */
  it('should completely clean database state after clearDatabase call', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          users: fc.array(fc.record({
            email: fc.emailAddress(),
            name: fc.string({ minLength: 2, maxLength: 50 }),
          }), { minLength: 1, maxLength: 10 }),
          bioPages: fc.array(fc.record({
            username: fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
            title: fc.string({ minLength: 1, maxLength: 100 }),
            bio: fc.string({ minLength: 0, maxLength: 500 }),
            theme: fc.constantFrom('default', 'dark', 'light', 'colorful'),
            isPublic: fc.boolean(),
          }), { minLength: 0, maxLength: 5 }),
        }),
        async (testData) => {
          // Clear database to start fresh
          await dbManager1.clearDatabase();

          // Create test data
          const createdUsers: User[] = [];
          for (const userData of testData.users) {
            const user = await dbManager1.createTestUser(userData);
            createdUsers.push(user);
          }

          const createdBioPages: BioPage[] = [];
          for (let i = 0; i < testData.bioPages.length && i < createdUsers.length; i++) {
            const bioPage = await dbManager1.createTestBioPage(createdUsers[i].id, testData.bioPages[i]);
            createdBioPages.push(bioPage);
          }

          // Verify data was created
          const userRepo = dbManager1.getRepository(User);
          const bioPageRepo = dbManager1.getRepository(BioPage);
          
          const usersBeforeCleanup = await userRepo.find();
          const bioPagesBeforeCleanup = await bioPageRepo.find();

          expect(usersBeforeCleanup.length).toBeGreaterThan(0);
          expect(usersBeforeCleanup).toHaveLength(testData.users.length);
          expect(bioPagesBeforeCleanup).toHaveLength(testData.bioPages.length);

          // Clear database
          await dbManager1.clearDatabase();

          // Verify complete cleanup
          const usersAfterCleanup = await userRepo.find();
          const bioPagesAfterCleanup = await bioPageRepo.find();
          const linksAfterCleanup = await dbManager1.getRepository(Link).find();

          // All tables should be empty
          expect(usersAfterCleanup).toHaveLength(0);
          expect(bioPagesAfterCleanup).toHaveLength(0);
          expect(linksAfterCleanup).toHaveLength(0);

          // Verify database statistics show empty state
          const stats = await dbManager1.getDatabaseStats();
          expect(stats.postgresql.records).toBe(0);
        }
      ),
      { numRuns: 100, timeout: 30000 }
    );
  });

  /**
   * Property: Parallel test execution should maintain isolation
   * For any concurrent test operations, each should maintain its own
   * isolated state without interference
   */
  it('should maintain isolation during parallel test execution', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          operation1: fc.record({
            userCount: fc.integer({ min: 1, max: 5 }),
            linkCount: fc.integer({ min: 0, max: 3 }),
          }),
          operation2: fc.record({
            userCount: fc.integer({ min: 1, max: 5 }),
            linkCount: fc.integer({ min: 0, max: 3 }),
          }),
        }),
        async (testData) => {
          // Clear both databases
          await Promise.all([
            dbManager1.clearDatabase(),
            dbManager2.clearDatabase()
          ]);

          // Execute parallel operations
          const [result1, result2] = await Promise.all([
            // Operation 1: Create users and links in database 1
            (async () => {
              const users: User[] = [];
              for (let i = 0; i < testData.operation1.userCount; i++) {
                const user = await dbManager1.createTestUser({
                  email: `user1_${i}_${Date.now()}@example.com`,
                });
                users.push(user);
              }

              const links: Link[] = [];
              for (let i = 0; i < testData.operation1.linkCount && i < users.length; i++) {
                const link = await dbManager1.createTestUrl(users[i].id, {
                  shortCode: `link1_${i}_${Date.now()}`,
                });
                links.push(link);
              }

              return { users, links };
            })(),

            // Operation 2: Create users and links in database 2
            (async () => {
              const users: User[] = [];
              for (let i = 0; i < testData.operation2.userCount; i++) {
                const user = await dbManager2.createTestUser({
                  email: `user2_${i}_${Date.now()}@example.com`,
                });
                users.push(user);
              }

              const links: Link[] = [];
              for (let i = 0; i < testData.operation2.linkCount && i < users.length; i++) {
                const link = await dbManager2.createTestUrl(users[i].id, {
                  shortCode: `link2_${i}_${Date.now()}`,
                });
                links.push(link);
              }

              return { users, links };
            })()
          ]);

          // Verify each database has only its own data
          const [db1Users, db1Links, db2Users, db2Links] = await Promise.all([
            dbManager1.getRepository(User).find(),
            dbManager1.getRepository(Link).find(),
            dbManager2.getRepository(User).find(),
            dbManager2.getRepository(Link).find(),
          ]);

          // Verify counts match expected values
          expect(db1Users).toHaveLength(testData.operation1.userCount);
          expect(db1Links).toHaveLength(testData.operation1.linkCount);
          expect(db2Users).toHaveLength(testData.operation2.userCount);
          expect(db2Links).toHaveLength(testData.operation2.linkCount);

          // Verify no data cross-contamination
          const db1UserEmails = new Set(db1Users.map(u => u.email));
          const db2UserEmails = new Set(db2Users.map(u => u.email));
          const db1LinkCodes = new Set(db1Links.map(l => l.shortCode));
          const db2LinkCodes = new Set(db2Links.map(l => l.shortCode));

          // No overlap should exist
          const emailIntersection = new Set([...db1UserEmails].filter(email => db2UserEmails.has(email)));
          const codeIntersection = new Set([...db1LinkCodes].filter(code => db2LinkCodes.has(code)));

          expect(emailIntersection.size).toBe(0);
          expect(codeIntersection.size).toBe(0);
        }
      ),
      { numRuns: 50, timeout: 45000 }
    );
  });

  /**
   * Property: Database state should be consistent after setup and teardown
   * For any database manager instance, setup followed by teardown should
   * leave the system in a clean, ready state
   */
  it('should maintain consistent state through setup and teardown cycles', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }), // Number of setup/teardown cycles
        async (cycles) => {
          let tempDbManager: TestDatabaseManager;

          for (let i = 0; i < cycles; i++) {
            // Create new database manager
            tempDbManager = new TestDatabaseManager({
              isolationLevel: 'transaction',
              autoCleanup: true,
              seedData: false,
              parallelSafe: true,
            });

            // Setup database
            await tempDbManager.setupTestDatabase();

            // Verify database is ready
            const isReady = await tempDbManager.isReady();
            expect(isReady).toBe(true);

            // Create some test data
            const user = await tempDbManager.createTestUser({
              email: `cycle_${i}_${Date.now()}@example.com`,
            });

            // Verify data was created
            const userRepo = tempDbManager.getRepository(User);
            const users = await userRepo.find();
            expect(users).toHaveLength(1);
            expect(users[0].id).toBe(user.id);

            // Teardown database
            await tempDbManager.teardownTestDatabase();

            // Verify cleanup (this should not throw)
            expect(async () => {
              await tempDbManager.teardownTestDatabase();
            }).not.toThrow();
          }
        }
      ),
      { numRuns: 20, timeout: 60000 }
    );
  });
});