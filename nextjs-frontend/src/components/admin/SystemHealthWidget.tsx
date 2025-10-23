'use client';

import {
  Card,
  CardContent,
  Typography,
  Box,
  Stack,
  Chip,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  CheckCircle,
  Warning,
  Error,
  Storage,
  Memory,
  Speed,
} from '@mui/icons-material';
import type { SystemHealth } from '@/lib/api/admin';

interface SystemHealthWidgetProps {
  health: SystemHealth | null;
}

export function SystemHealthWidget({ health }: SystemHealthWidgetProps) {
  if (!health) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            System Health
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Unable to load system health data
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'connected':
        return 'success';
      case 'warning':
        return 'warning';
      case 'critical':
      case 'disconnected':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'connected':
        return <CheckCircle color="success" />;
      case 'warning':
        return <Warning color="warning" />;
      case 'critical':
      case 'disconnected':
        return <Error color="error" />;
      default:
        return <CheckCircle />;
    }
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6">
            System Health
          </Typography>
          <Chip
            label={health.status.toUpperCase()}
            color={getStatusColor(health.status) as any}
            variant="outlined"
          />
        </Box>

        <Stack spacing={3}>
          {/* Database Status */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              {getStatusIcon(health.database.status)}
              <Typography variant="body1" fontWeight="medium">
                Database
              </Typography>
              <Chip
                label={health.database.status}
                size="small"
                color={getStatusColor(health.database.status) as any}
                variant="outlined"
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              Response time: {health.database.responseTime}ms
            </Typography>
          </Box>

          {/* Redis Status */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              {getStatusIcon(health.redis.status)}
              <Typography variant="body1" fontWeight="medium">
                Redis Cache
              </Typography>
              <Chip
                label={health.redis.status}
                size="small"
                color={getStatusColor(health.redis.status) as any}
                variant="outlined"
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              Response time: {health.redis.responseTime}ms
            </Typography>
          </Box>

          {/* Memory Usage */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Memory color="primary" />
              <Typography variant="body1" fontWeight="medium">
                Memory Usage
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {health.memory.percentage.toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={health.memory.percentage}
              color={health.memory.percentage > 80 ? 'error' : health.memory.percentage > 60 ? 'warning' : 'primary'}
              sx={{ mb: 1 }}
            />
            <Typography variant="body2" color="text.secondary">
              {(health.memory.used / 1024 / 1024 / 1024).toFixed(2)} GB / {(health.memory.total / 1024 / 1024 / 1024).toFixed(2)} GB
            </Typography>
          </Box>

          {/* CPU Usage */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Speed color="primary" />
              <Typography variant="body1" fontWeight="medium">
                CPU Usage
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {health.cpu.usage.toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={health.cpu.usage}
              color={health.cpu.usage > 80 ? 'error' : health.cpu.usage > 60 ? 'warning' : 'primary'}
            />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}