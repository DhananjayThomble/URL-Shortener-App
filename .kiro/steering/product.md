# SnapURL Product Overview

SnapURL is an open-source URL shortener web application with Chrome extension support. The platform simplifies converting long URLs into short, shareable links with comprehensive user management and analytics.

## Core Features
- User authentication (signup, login, email verification, password reset)
- URL shortening with 10-character random strings
- Visit tracking and analytics
- User-specific URL management and deletion
- QR code generation for shortened URLs
- Excel export functionality
- Chrome extension for quick URL shortening
- API documentation via Swagger

## Architecture
Multi-component system with:
- **Legacy Backend**: Express.js/Node.js with MongoDB
- **Modern Backend**: NestJS v10 with hybrid database (PostgreSQL + MongoDB + Redis)
- **Frontend**: React.js with Vite build system
- **Chrome Extension**: Manifest v3 browser extension
- **Deployment**: AWS EC2 (backend) + Netlify (frontend)

## Target Users
Developers and users who need a reliable, feature-rich URL shortening service with analytics and management capabilities.

## Business Model
Open-source project with community contributions, focusing on developer-friendly features and enterprise-grade reliability.