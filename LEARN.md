# Learning Resources for SnapURL 2.0

> **Comprehensive Learning Paths**: Master the SnapURL technology stack with curated resources

## 🎯 Overview

SnapURL is built with modern technologies:
- **Backend**: NestJS 10 + TypeScript + Node.js
- **Frontend**: React 19 + Vite + TypeScript
- **Databases**: PostgreSQL + MongoDB + Redis
- **Infrastructure**: Docker + GitHub Codespaces

This guide provides structured learning paths for contributors and developers.

## 📚 Learning Paths

### Path 1: Complete Beginner

**Goal**: Understand web development fundamentals

#### Prerequisites (2-4 weeks)
1. **HTML & CSS**
   - [freeCodeCamp Responsive Web Design](https://www.freecodecamp.org/learn/2022/responsive-web-design/)
   - [MDN HTML Basics](https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/HTML_basics)
   - [CSS Tricks](https://css-tricks.com/guides/)

2. **JavaScript Fundamentals**
   - [JavaScript.info](https://javascript.info/) - Complete modern tutorial
   - [freeCodeCamp JavaScript](https://www.freecodecamp.org/learn/javascript-algorithms-and-data-structures/)
   - [Eloquent JavaScript](https://eloquentjavascript.net/) (book, free online)

3. **Git & GitHub**
   - [GitHub Guides](https://guides.github.com/)
   - [Git Handbook](https://guides.github.com/introduction/git-handbook/)
   - [Learn Git Branching](https://learngitbranching.js.org/)

#### Next: Move to Path 2 (Frontend) or Path 3 (Backend)

---

### Path 2: Frontend Development (4-6 weeks)

**Goal**: Build React + TypeScript applications

#### 1. TypeScript (1 week)
- **Official Docs**: [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- **Interactive**: [TypeScript Exercises](https://typescript-exercises.github.io/)
- **Video**: [TypeScript Course - FreeCodeCamp](https://www.youtube.com/watch?v=30LWjhZzg50)

**Key Concepts**:
- Types, Interfaces, Generics
- Union and Intersection Types
- Type Guards and Narrowing
- Utility Types

#### 2. React Fundamentals (2 weeks)
- **Official Docs**: [React.dev](https://react.dev/learn)
- **Interactive**: [React Tutorial](https://react.dev/learn/tutorial-tic-tac-toe)
- **Video**: [React Course - FreeCodeCamp](https://www.youtube.com/watch?v=bMknfKXIFA8)

**Key Concepts**:
- Components and Props
- State and Lifecycle
- Hooks (useState, useEffect, useContext)
- Event Handling
- Conditional Rendering

#### 3. React Advanced (1-2 weeks)
- **Hooks Deep Dive**: [React Hooks](https://react.dev/reference/react)
- **Custom Hooks**: [Building Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)
- **Performance**: [React Performance Optimization](https://react.dev/learn/render-and-commit)

**Key Concepts**:
- useCallback, useMemo
- useReducer for complex state
- Custom hooks
- Code splitting and lazy loading

#### 4. Build Tools - Vite (3 days)
- **Official Docs**: [Vite Guide](https://vitejs.dev/guide/)
- **Why Vite**: [Vite Overview](https://vitejs.dev/guide/why.html)

#### 5. State Management (1 week)
**TanStack Query**:
- [Docs](https://tanstack.com/query/latest/docs/react/overview)
- [Tutorial](https://tanstack.com/query/latest/docs/react/quick-start)

**Zustand**:
- [Docs](https://zustand-demo.pmnd.rs/)
- [Getting Started](https://docs.pmnd.rs/zustand/getting-started/introduction)

#### 6. Styling - Tailwind CSS (3 days)
- **Official Docs**: [Tailwind CSS](https://tailwindcss.com/docs)
- **Interactive**: [Tailwind Play](https://play.tailwindcss.com/)
- **Video**: [Tailwind Crash Course](https://www.youtube.com/watch?v=UBOj6rqRUME)

#### 7. UI Components - Radix UI (3 days)
- **Official Docs**: [Radix UI](https://www.radix-ui.com/docs/primitives/overview/introduction)
- **shadcn/ui**: [Components](https://ui.shadcn.com/)

#### 8. Testing (1 week)
- **React Testing Library**: [Docs](https://testing-library.com/docs/react-testing-library/intro/)
- **Jest**: [Getting Started](https://jestjs.io/docs/getting-started)
- **E2E Testing**: [Playwright](https://playwright.dev/docs/intro)

**Practice Project**: Build a simple URL shortener frontend
- Create URL form
- Display URL list
- Add analytics dashboard
- Implement authentication

---

### Path 3: Backend Development (4-6 weeks)

**Goal**: Build NestJS + TypeScript APIs

#### 1. Node.js Fundamentals (1 week)
- **Official Docs**: [Node.js Guide](https://nodejs.org/en/docs/guides/)
- **Video**: [Node.js Tutorial](https://www.youtube.com/watch?v=TlB_eWDSMt4)

**Key Concepts**:
- Event Loop
- Modules and NPM
- Async/Await and Promises
- File System
- HTTP Module

#### 2. TypeScript (1 week)
- Same as Frontend Path - see above

#### 3. NestJS Fundamentals (2 weeks)
- **Official Docs**: [NestJS Documentation](https://docs.nestjs.com/)
- **Video**: [NestJS Course](https://www.youtube.com/watch?v=GHTA143_b-s)
- **Course**: [NestJS Zero to Hero](https://www.udemy.com/course/nestjs-zero-to-hero/)

**Key Concepts**:
- Modules, Controllers, Services
- Dependency Injection
- Providers and Custom Providers
- Middleware, Guards, Interceptors
- Exception Filters
- Pipes and Validation

#### 4. Database Integration (2 weeks)

**PostgreSQL + TypeORM**:
- [TypeORM Docs](https://typeorm.io/)
- [NestJS + TypeORM](https://docs.nestjs.com/techniques/database)
- [PostgreSQL Tutorial](https://www.postgresqltutorial.com/)

**MongoDB + Mongoose**:
- [Mongoose Docs](https://mongoosejs.com/docs/guide.html)
- [NestJS + Mongoose](https://docs.nestjs.com/techniques/mongodb)
- [MongoDB University](https://university.mongodb.com/) (free courses)

**Redis**:
- [Redis Tutorial](https://redis.io/docs/getting-started/)
- [NestJS Caching](https://docs.nestjs.com/techniques/caching)

**Key Concepts**:
- Database schema design
- Migrations
- Relationships (One-to-Many, Many-to-Many)
- Query optimization
- Indexes
- Transactions

#### 5. Authentication & Security (1 week)
- **Passport.js**: [NestJS Authentication](https://docs.nestjs.com/security/authentication)
- **JWT**: [JWT.io](https://jwt.io/introduction)
- **Security**: [OWASP Top 10](https://owasp.org/www-project-top-ten/)

**Key Concepts**:
- JWT tokens
- Password hashing (bcrypt)
- Guards and strategies
- Role-based access control
- Security best practices

#### 6. Testing (1 week)
- **Jest**: [Testing in NestJS](https://docs.nestjs.com/fundamentals/testing)
- **E2E Testing**: [Supertest](https://github.com/visionmedia/supertest)

**Practice Project**: Build a simple URL shortener API
- User authentication
- URL CRUD operations
- Analytics tracking
- Rate limiting

---

### Path 4: Database Administration (2-3 weeks)

#### PostgreSQL
- [PostgreSQL Tutorial](https://www.postgresqltutorial.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

**Topics**:
- SQL queries and optimization
- Indexes and performance
- Backup and recovery
- Connection pooling

#### MongoDB
- [MongoDB University](https://university.mongodb.com/) - M001: MongoDB Basics
- [MongoDB Documentation](https://www.mongodb.com/docs/)

**Topics**:
- Document design
- Aggregation pipeline
- Indexes
- Replica sets

#### Redis
- [Redis University](https://university.redis.com/) - RU101: Introduction to Redis
- [Redis Documentation](https://redis.io/docs/)

**Topics**:
- Data types
- Caching strategies
- Pub/Sub
- Persistence

---

### Path 5: DevOps & Deployment (2-3 weeks)

#### Docker
- [Docker Getting Started](https://docs.docker.com/get-started/)
- [Docker Compose](https://docs.docker.com/compose/)
- [Docker for Node.js](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)

#### CI/CD
- [GitHub Actions](https://docs.github.com/en/actions/learn-github-actions)
- [Testing with GitHub Actions](https://docs.github.com/en/actions/automating-builds-and-tests)

#### Cloud Deployment
- **AWS**: [AWS Free Tier](https://aws.amazon.com/free/)
- **Netlify**: [Netlify Docs](https://docs.netlify.com/)
- **Heroku**: [Heroku Node.js](https://devcenter.heroku.com/articles/deploying-nodejs)

---

## 🎬 Video Tutorials

### Full-Stack Development
1. **[Full Stack Development Tutorial](https://www.youtube.com/watch?v=nu_pCVPKzTk)** - FreeCodeCamp (8 hours)
2. **[MERN Stack Course](https://www.youtube.com/watch?v=-0exw-9YJBo)** - Traversy Media (12 hours)

### NestJS Specific
1. **[NestJS Crash Course](https://www.youtube.com/watch?v=GHTA143_b-s)** - Traversy Media (1 hour)
2. **[NestJS Full Course](https://www.youtube.com/watch?v=ulfU5vY6I78)** - FreeCodeCamp (6 hours)

### React Specific
1. **[React 18 Tutorial](https://www.youtube.com/watch?v=bMknfKXIFA8)** - FreeCodeCamp (12 hours)
2. **[React + TypeScript](https://www.youtube.com/watch?v=FJDVKeh7RJI)** - FreeCodeCamp (5 hours)

---

## 📖 Recommended Books

### JavaScript & TypeScript
- **"You Don't Know JS"** series by Kyle Simpson (free online)
- **"Programming TypeScript"** by Boris Cherny
- **"Effective TypeScript"** by Dan Vanderkam

### React
- **"React Up & Running"** by Stoyan Stefanov
- **"Learning React"** by Alex Banks & Eve Porcello

### Node.js & NestJS
- **"Node.js Design Patterns"** by Mario Casciaro
- **"Mastering NestJS"** (online documentation)

### Databases
- **"PostgreSQL: Up and Running"** by Regina Obe & Leo Hsu
- **"MongoDB: The Definitive Guide"** by Shannon Bradshaw

---

## 🛠️ Hands-On Practice

### Interactive Platforms
1. **[LeetCode](https://leetcode.com/)** - Coding challenges
2. **[HackerRank](https://www.hackerrank.com/)** - Programming practice
3. **[Frontend Mentor](https://www.frontendmentor.io/)** - Frontend challenges
4. **[Exercism](https://exercism.org/)** - Code practice with mentorship

### Project Ideas
1. **Beginner**: Todo app with React + NestJS
2. **Intermediate**: Blog platform with authentication
3. **Advanced**: URL shortener (contribute to SnapURL!)
4. **Expert**: Real-time chat application

---

## 📰 Blogs & Articles

### General
- [Dev.to](https://dev.to/)
- [Medium - JavaScript](https://medium.com/tag/javascript)
- [Hashnode](https://hashnode.com/)

### NestJS
- [NestJS Blog](https://nestjs.com/blog)
- [LogRocket - NestJS](https://blog.logrocket.com/tag/nestjs/)

### React
- [React Blog](https://react.dev/blog)
- [Kent C. Dodds Blog](https://kentcdodds.com/blog)

---

## 🎓 Online Courses

### Free Courses
- **FreeCodeCamp**: Full curriculum for web development
- **The Odin Project**: Full-stack JavaScript path
- **MDN Web Docs**: Comprehensive web development guides

### Paid Courses (Worth It)
- **Udemy**: NestJS Zero to Hero (~$15)
- **Egghead.io**: React and TypeScript courses
- **Frontend Masters**: Advanced JavaScript & React

---

## 💬 Community & Support

### Discord/Slack
- [Reactiflux](https://www.reactiflux.com/) - React community
- [NestJS Discord](https://discord.gg/nestjs)
- [TypeScript Community](https://discord.gg/typescript)

### Forums
- [Stack Overflow](https://stackoverflow.com/)
- [Reddit - r/reactjs](https://www.reddit.com/r/reactjs/)
- [Reddit - r/node](https://www.reddit.com/r/node/)

### GitHub
- Explore [SnapURL Issues](https://github.com/DhananjayThomble/URL-Shortener-App/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) labeled "good first issue"

---

## 🚀 Contributing to SnapURL

Once you've learned the basics:

1. **Read the Documentation**: [docs/](./docs/)
2. **Setup Development Environment**: [Development Guide](./docs/DEVELOPMENT.md)
3. **Find an Issue**: [Good First Issues](https://github.com/DhananjayThomble/URL-Shortener-App/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
4. **Follow Guidelines**: [CONTRIBUTING.md](./CONTRIBUTING.md)
5. **Ask Questions**: [GitHub Discussions](https://github.com/DhananjayThomble/URL-Shortener-App/discussions)

---

## 📊 Learning Roadmap Visualization

```
Month 1: Fundamentals
├─ Week 1-2: JavaScript/TypeScript basics
├─ Week 3: Git & GitHub
└─ Week 4: Choose Frontend or Backend

Month 2-3: Specialization
├─ Frontend Path: React, Hooks, State Management
├─ Backend Path: NestJS, Databases, Authentication
└─ Practice: Build small projects

Month 4: Integration & Advanced Topics
├─ Full-stack integration
├─ Testing (Unit, Integration, E2E)
├─ DevOps basics (Docker, CI/CD)
└─ Contribute to SnapURL

Month 5+: Advanced & Continuous Learning
├─ Advanced patterns and architectures
├─ Performance optimization
├─ Security best practices
└─ Stay updated with latest technologies
```

---

## 🎯 Tips for Success

1. **Learn by Doing**: Build projects while learning
2. **Read Code**: Study SnapURL's codebase
3. **Ask Questions**: No question is too simple
4. **Be Consistent**: 1 hour daily > 7 hours weekly
5. **Join Communities**: Learn from others
6. **Contribute**: Start with documentation, then code
7. **Stay Updated**: Follow tech blogs and newsletters

---

## 📬 Need Help?

- **Documentation Issues**: Open an issue on GitHub
- **Learning Questions**: [GitHub Discussions](https://github.com/DhananjayThomble/URL-Shortener-App/discussions)
- **General Support**: support@snapurl.in

---

**Happy Learning! 🚀**

Remember: Everyone starts somewhere. The SnapURL community is here to support your learning journey!

