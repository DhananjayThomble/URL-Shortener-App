import { rest } from 'msw'
import { mockUser, mockAdminUser, mockUrl, mockAnalytics } from '../utils/test-utils'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api'

export const handlers = [
  // Auth endpoints
  rest.post(`${API_BASE_URL}/auth/login`, (req, res, ctx) => {
    const { email, password } = req.body as any
    
    if (email === 'admin@example.com') {
      return res(
        ctx.json({
          user: mockAdminUser,
          tokens: {
            accessToken: 'mock-admin-token',
            refreshToken: 'mock-admin-refresh',
            expiresIn: 3600,
          },
        })
      )
    }
    
    if (email === 'test@example.com' && password === 'password') {
      return res(
        ctx.json({
          user: mockUser,
          tokens: {
            accessToken: 'mock-access-token',
            refreshToken: 'mock-refresh-token',
            expiresIn: 3600,
          },
        })
      )
    }
    
    return res(
      ctx.status(401),
      ctx.json({ message: 'Invalid credentials' })
    )
  }),

  rest.post(`${API_BASE_URL}/auth/register`, (req, res, ctx) => {
    const { email, name } = req.body as any
    
    if (email === 'existing@example.com') {
      return res(
        ctx.status(409),
        ctx.json({ message: 'User already exists' })
      )
    }
    
    return res(
      ctx.json({
        user: { ...mockUser, email, name },
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          expiresIn: 3600,
        },
      })
    )
  }),

  rest.post(`${API_BASE_URL}/auth/refresh`, (req, res, ctx) => {
    return res(
      ctx.json({
        tokens: {
          accessToken: 'new-mock-access-token',
          refreshToken: 'new-mock-refresh-token',
          expiresIn: 3600,
        },
      })
    )
  }),

  rest.post(`${API_BASE_URL}/auth/logout`, (req, res, ctx) => {
    return res(ctx.json({ message: 'Logged out successfully' }))
  }),

  rest.post(`${API_BASE_URL}/auth/change-password`, (req, res, ctx) => {
    const { currentPassword } = req.body as any
    
    if (currentPassword !== 'currentpassword') {
      return res(
        ctx.status(400),
        ctx.json({ message: 'Current password is incorrect' })
      )
    }
    
    return res(ctx.json({ message: 'Password changed successfully' }))
  }),

  rest.post(`${API_BASE_URL}/auth/resend-verification`, (req, res, ctx) => {
    return res(ctx.json({ message: 'Verification email sent' }))
  }),

  // User endpoints
  rest.get(`${API_BASE_URL}/users/profile`, (req, res, ctx) => {
    return res(ctx.json(mockUser))
  }),

  rest.patch(`${API_BASE_URL}/users/profile`, (req, res, ctx) => {
    const updates = req.body as any
    return res(ctx.json({ ...mockUser, ...updates }))
  }),

  rest.post(`${API_BASE_URL}/users/verify-email`, (req, res, ctx) => {
    return res(ctx.json({ message: 'Email verified successfully' }))
  }),

  // URL endpoints
  rest.get(`${API_BASE_URL}/urls`, (req, res, ctx) => {
    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = parseInt(url.searchParams.get('limit') || '20')
    
    return res(
      ctx.json({
        data: [mockUrl],
        pagination: {
          page,
          limit,
          total: 1,
          totalPages: 1,
        },
      })
    )
  }),

  rest.post(`${API_BASE_URL}/urls`, (req, res, ctx) => {
    const { originalUrl, customBackHalf } = req.body as any
    
    if (customBackHalf === 'taken') {
      return res(
        ctx.status(409),
        ctx.json({ message: 'Custom back half already taken' })
      )
    }
    
    return res(
      ctx.json({
        ...mockUrl,
        originalUrl,
        customBackHalf,
        shortCode: customBackHalf || 'abc123',
      })
    )
  }),

  rest.get(`${API_BASE_URL}/urls/:id`, (req, res, ctx) => {
    return res(ctx.json({ ...mockUrl, id: req.params.id }))
  }),

  rest.patch(`${API_BASE_URL}/urls/:id`, (req, res, ctx) => {
    const updates = req.body as any
    return res(ctx.json({ ...mockUrl, id: req.params.id, ...updates }))
  }),

  rest.delete(`${API_BASE_URL}/urls/:id`, (req, res, ctx) => {
    return res(ctx.json({ message: 'URL deleted successfully' }))
  }),

  rest.get(`${API_BASE_URL}/urls/:id/analytics`, (req, res, ctx) => {
    return res(ctx.json(mockAnalytics))
  }),

  // Admin endpoints
  rest.get(`${API_BASE_URL}/admin/dashboard`, (req, res, ctx) => {
    return res(
      ctx.json({
        users: {
          total: 1000,
          newThisMonth: 50,
          activeThisWeek: 200,
        },
        urls: {
          total: 5000,
          createdThisMonth: 300,
          totalClicks: 50000,
        },
        analytics: {
          clicksToday: 500,
          clicksThisWeek: 3000,
          topCountries: mockAnalytics.topCountries,
          topDevices: mockAnalytics.topDevices,
        },
        system: {
          cacheHitRate: 95.5,
          avgResponseTime: 120,
          uptime: 99.9,
        },
      })
    )
  }),

  rest.get(`${API_BASE_URL}/admin/health`, (req, res, ctx) => {
    return res(
      ctx.json({
        status: 'healthy',
        database: {
          status: 'connected',
          responseTime: 50,
        },
        redis: {
          status: 'connected',
          responseTime: 10,
        },
        memory: {
          used: 2147483648, // 2GB
          total: 8589934592, // 8GB
          percentage: 25,
        },
        cpu: {
          usage: 15.5,
        },
      })
    )
  }),

  rest.get(`${API_BASE_URL}/admin/users`, (req, res, ctx) => {
    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = parseInt(url.searchParams.get('limit') || '25')
    
    return res(
      ctx.json({
        users: [
          {
            ...mockUser,
            urlCount: 5,
            totalClicks: 100,
          },
        ],
        pagination: {
          page,
          limit,
          total: 1,
          pages: 1,
        },
      })
    )
  }),

  rest.post(`${API_BASE_URL}/admin/users/:id/deactivate`, (req, res, ctx) => {
    return res(ctx.json({ message: 'User deactivated successfully' }))
  }),

  rest.get(`${API_BASE_URL}/admin/admins`, (req, res, ctx) => {
    return res(
      ctx.json({
        admins: [
          {
            ...mockAdminUser,
            permissions: ['user_management', 'analytics_view'],
            isActive: true,
          },
        ],
      })
    )
  }),

  rest.post(`${API_BASE_URL}/admin/admins`, (req, res, ctx) => {
    const { email, name, permissions } = req.body as any
    
    if (email === 'existing@example.com') {
      return res(
        ctx.status(409),
        ctx.json({ message: 'Admin with this email already exists' })
      )
    }
    
    return res(
      ctx.json({
        message: 'Admin created successfully',
        admin: {
          ...mockAdminUser,
          email,
          name,
          permissions,
        },
      })
    )
  }),

  rest.put(`${API_BASE_URL}/admin/admins/:id`, (req, res, ctx) => {
    const updates = req.body as any
    return res(
      ctx.json({
        message: 'Admin updated successfully',
        admin: {
          ...mockAdminUser,
          id: req.params.id,
          ...updates,
        },
      })
    )
  }),

  rest.delete(`${API_BASE_URL}/admin/admins/:id`, (req, res, ctx) => {
    return res(ctx.status(204))
  }),

  rest.get(`${API_BASE_URL}/admin/audit-logs`, (req, res, ctx) => {
    return res(
      ctx.json({
        logs: [
          {
            id: '1',
            adminId: 'admin-1',
            action: 'user_created',
            resource: 'user',
            resourceId: 'user-1',
            details: { email: 'test@example.com' },
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0...',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
      })
    )
  }),

  rest.get(`${API_BASE_URL}/admin/analytics/overview`, (req, res, ctx) => {
    return res(
      ctx.json({
        overview: {
          totalUsers: 1000,
          totalUrls: 5000,
          totalClicks: 50000,
          cacheHitRate: 95.5,
        },
        trends: {
          newUsersThisMonth: 50,
          newUrlsThisMonth: 300,
          clicksToday: 500,
          clicksThisWeek: 3000,
        },
        topCountries: mockAnalytics.topCountries,
        topDevices: mockAnalytics.topDevices,
      })
    )
  }),

  // Error simulation endpoints
  rest.get(`${API_BASE_URL}/error/500`, (req, res, ctx) => {
    return res(
      ctx.status(500),
      ctx.json({ message: 'Internal server error' })
    )
  }),

  rest.get(`${API_BASE_URL}/error/network`, (req, res, ctx) => {
    return res.networkError('Network error')
  }),
]