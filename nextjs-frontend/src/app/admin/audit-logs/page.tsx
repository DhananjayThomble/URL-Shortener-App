'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Stack,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  InputAdornment,
} from '@mui/material';
import {
  Search,
  Refresh,
  Download,
  ExpandMore,
  Security,
  Person,
  AdminPanelSettings,
  Link as LinkIcon,
} from '@mui/icons-material';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { adminAPI, type AuditLog } from '@/lib/api/admin';
import toast from 'react-hot-toast';

type LogFilter = 'all' | 'security' | 'user' | 'admin' | 'url';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      let response;
      
      switch (logFilter) {
        case 'security':
          response = await adminAPI.getSecurityLogs();
          break;
        case 'all':
        default:
          response = await adminAPI.getAuditLogs();
          break;
      }
      
      setLogs(response.data.logs);
    } catch (error: any) {
      console.error('Failed to fetch audit logs:', error);
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [logFilter]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handleExportLogs = () => {
    // TODO: Implement log export functionality
    toast('Log export coming soon!', { icon: 'ℹ️' });
  };

  const getActionIcon = (action: string) => {
    if (action.includes('login') || action.includes('logout')) {
      return <Security color="primary" />;
    }
    if (action.includes('user')) {
      return <Person color="secondary" />;
    }
    if (action.includes('admin')) {
      return <AdminPanelSettings color="error" />;
    }
    if (action.includes('url')) {
      return <LinkIcon color="info" />;
    }
    return <Security color="action" />;
  };

  const getActionColor = (action: string) => {
    if (action.includes('failed') || action.includes('error') || action.includes('delete')) {
      return 'error';
    }
    if (action.includes('login') || action.includes('create')) {
      return 'success';
    }
    if (action.includes('update') || action.includes('change')) {
      return 'warning';
    }
    return 'info';
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.resource.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.adminId.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesSearch;
  });

  const formatLogDetails = (details: Record<string, any>) => {
    return Object.entries(details).map(([key, value]) => (
      <Box key={key} sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>
          {key}:
        </Typography>
        <Typography variant="body2" component="span" sx={{ ml: 1 }}>
          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
        </Typography>
      </Box>
    ));
  };

  return (
    <AuthGuard requireAuth={true} requiredRole="admin">
      <AdminLayout>
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h4" component="h1" gutterBottom>
                Audit Logs
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Monitor system activities and security events
              </Typography>
            </Box>
            <Stack direction="row" spacing={2}>
              <Button
                variant="outlined"
                startIcon={<Download />}
                onClick={handleExportLogs}
              >
                Export
              </Button>
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={fetchLogs}
              >
                Refresh
              </Button>
            </Stack>
          </Box>

          <Card>
            <CardContent>
              {/* Filters */}
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
                <TextField
                  placeholder="Search logs by action, resource, or admin ID..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  sx={{ flexGrow: 1 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search />
                      </InputAdornment>
                    ),
                  }}
                />
                
                <FormControl sx={{ minWidth: 200 }}>
                  <InputLabel>Filter by Type</InputLabel>
                  <Select
                    value={logFilter}
                    label="Filter by Type"
                    onChange={(e) => setLogFilter(e.target.value as LogFilter)}
                  >
                    <MenuItem value="all">All Logs</MenuItem>
                    <MenuItem value="security">Security Events</MenuItem>
                    <MenuItem value="user">User Actions</MenuItem>
                    <MenuItem value="admin">Admin Actions</MenuItem>
                    <MenuItem value="url">URL Actions</MenuItem>
                  </Select>
                </FormControl>
              </Stack>

              {/* Logs Table */}
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Action</TableCell>
                      <TableCell>Resource</TableCell>
                      <TableCell>Admin</TableCell>
                      <TableCell>IP Address</TableCell>
                      <TableCell>Timestamp</TableCell>
                      <TableCell>Details</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          Loading audit logs...
                        </TableCell>
                      </TableRow>
                    ) : filteredLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          No audit logs found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredLogs.map((log) => (
                        <TableRow key={log.id} hover>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              {getActionIcon(log.action)}
                              <Box>
                                <Typography variant="body2" fontWeight="medium">
                                  {log.action.replace(/_/g, ' ').toUpperCase()}
                                </Typography>
                                <Chip
                                  label={log.action}
                                  size="small"
                                  color={getActionColor(log.action) as any}
                                  variant="outlined"
                                />
                              </Box>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {log.resource}
                            </Typography>
                            {log.resourceId && (
                              <Typography variant="caption" color="text.secondary">
                                ID: {log.resourceId}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {log.adminId}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {log.ipAddress}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {new Date(log.createdAt).toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="small"
                              onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                            >
                              {expandedLog === log.id ? 'Hide' : 'Show'} Details
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Expanded Log Details */}
              {expandedLog && (
                <Box sx={{ mt: 3 }}>
                  {filteredLogs
                    .filter(log => log.id === expandedLog)
                    .map(log => (
                      <Accordion key={log.id} expanded>
                        <AccordionSummary>
                          <Typography variant="h6">
                            Log Details - {log.action}
                          </Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                          <Stack spacing={2}>
                            <Box>
                              <Typography variant="subtitle2" gutterBottom>
                                Basic Information
                              </Typography>
                              <Box sx={{ pl: 2 }}>
                                <Typography variant="body2">
                                  <strong>ID:</strong> {log.id}
                                </Typography>
                                <Typography variant="body2">
                                  <strong>Action:</strong> {log.action}
                                </Typography>
                                <Typography variant="body2">
                                  <strong>Resource:</strong> {log.resource}
                                </Typography>
                                <Typography variant="body2">
                                  <strong>Resource ID:</strong> {log.resourceId || 'N/A'}
                                </Typography>
                                <Typography variant="body2">
                                  <strong>Admin ID:</strong> {log.adminId}
                                </Typography>
                                <Typography variant="body2">
                                  <strong>IP Address:</strong> {log.ipAddress}
                                </Typography>
                                <Typography variant="body2">
                                  <strong>User Agent:</strong> {log.userAgent || 'N/A'}
                                </Typography>
                                <Typography variant="body2">
                                  <strong>Timestamp:</strong> {new Date(log.createdAt).toLocaleString()}
                                </Typography>
                              </Box>
                            </Box>

                            {Object.keys(log.details).length > 0 && (
                              <Box>
                                <Typography variant="subtitle2" gutterBottom>
                                  Additional Details
                                </Typography>
                                <Box sx={{ pl: 2 }}>
                                  {formatLogDetails(log.details)}
                                </Box>
                              </Box>
                            )}
                          </Stack>
                        </AccordionDetails>
                      </Accordion>
                    ))}
                </Box>
              )}

              {/* Summary Stats */}
              <Box sx={{ mt: 3, pt: 3, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary">
                  Showing {filteredLogs.length} of {logs.length} audit logs
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Box>
      </AdminLayout>
    </AuthGuard>
  );
}