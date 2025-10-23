'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Stack,
  InputAdornment,
} from '@mui/material';
import {
  Search,
  MoreVert,
  Visibility,
  Block,
  Delete,
  Download,
  Refresh,
} from '@mui/icons-material';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { adminAPI, type UserListItem } from '@/lib/api/admin';
import toast from 'react-hot-toast';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalUsers, setTotalUsers] = useState(0);
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<null | HTMLElement>(null);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState('');

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getAllUsers(page + 1, rowsPerPage);
      setUsers(response.data.users);
      setTotalUsers(response.data.pagination.total);
    } catch (error: any) {
      console.error('Failed to fetch users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [page, rowsPerPage]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    // TODO: Implement search functionality
  };

  const handleActionMenuOpen = (event: React.MouseEvent<HTMLElement>, user: UserListItem) => {
    setActionMenuAnchor(event.currentTarget);
    setSelectedUser(user);
  };

  const handleActionMenuClose = () => {
    setActionMenuAnchor(null);
    setSelectedUser(null);
  };

  const handleViewUser = () => {
    if (selectedUser) {
      // TODO: Navigate to user detail page
      toast.info('User detail view coming soon!');
    }
    handleActionMenuClose();
  };

  const handleDeactivateUser = () => {
    setDeactivateDialogOpen(true);
    handleActionMenuClose();
  };

  const confirmDeactivateUser = async () => {
    if (!selectedUser || !deactivateReason.trim()) {
      toast.error('Please provide a reason for deactivation');
      return;
    }

    try {
      await adminAPI.deactivateUser(selectedUser.id, deactivateReason);
      toast.success('User deactivated successfully');
      setDeactivateDialogOpen(false);
      setDeactivateReason('');
      setSelectedUser(null);
      fetchUsers();
    } catch (error: any) {
      console.error('Failed to deactivate user:', error);
      toast.error('Failed to deactivate user');
    }
  };

  const handleDeleteUser = () => {
    if (selectedUser) {
      // TODO: Implement user deletion with confirmation
      toast.info('User deletion coming soon!');
    }
    handleActionMenuClose();
  };

  const handleExportUsers = () => {
    // TODO: Implement user export functionality
    toast.info('User export coming soon!');
  };

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AuthGuard requireAuth={true} requiredRole="admin">
      <AdminLayout>
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h4" component="h1" gutterBottom>
                User Management
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Manage user accounts and monitor user activity
              </Typography>
            </Box>
            <Stack direction="row" spacing={2}>
              <Button
                variant="outlined"
                startIcon={<Download />}
                onClick={handleExportUsers}
              >
                Export
              </Button>
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={fetchUsers}
              >
                Refresh
              </Button>
            </Stack>
          </Box>

          <Card>
            <CardContent>
              {/* Search and Filters */}
              <Box sx={{ mb: 3 }}>
                <TextField
                  placeholder="Search users by name or email..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  fullWidth
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search />
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>

              {/* Users Table */}
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>User</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>URLs</TableCell>
                      <TableCell>Total Clicks</TableCell>
                      <TableCell>Joined</TableCell>
                      <TableCell>Last Login</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} align="center">
                          Loading users...
                        </TableCell>
                      </TableRow>
                    ) : filteredUsers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} align="center">
                          No users found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUsers.map((user) => (
                        <TableRow key={user.id} hover>
                          <TableCell>
                            <Box>
                              <Typography variant="body2" fontWeight="medium">
                                {user.name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {user.email}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={1}>
                              <Chip
                                label={user.role.toUpperCase()}
                                size="small"
                                color={user.role === 'admin' ? 'secondary' : 'default'}
                                variant="outlined"
                              />
                              <Chip
                                label={user.isEmailVerified ? 'Verified' : 'Unverified'}
                                size="small"
                                color={user.isEmailVerified ? 'success' : 'warning'}
                                variant="outlined"
                              />
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {user.urlCount.toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {user.totalClicks.toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {new Date(user.createdAt).toLocaleDateString()}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {user.lastLoginAt
                                ? new Date(user.lastLoginAt).toLocaleDateString()
                                : 'Never'}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <IconButton
                              onClick={(e) => handleActionMenuOpen(e, user)}
                            >
                              <MoreVert />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Pagination */}
              <TablePagination
                component="div"
                count={totalUsers}
                page={page}
                onPageChange={(_, newPage) => setPage(newPage)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => {
                  setRowsPerPage(parseInt(e.target.value, 10));
                  setPage(0);
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
              />
            </CardContent>
          </Card>

          {/* Action Menu */}
          <Menu
            anchorEl={actionMenuAnchor}
            open={Boolean(actionMenuAnchor)}
            onClose={handleActionMenuClose}
          >
            <MenuItem onClick={handleViewUser}>
              <Visibility sx={{ mr: 1 }} />
              View Details
            </MenuItem>
            <MenuItem onClick={handleDeactivateUser}>
              <Block sx={{ mr: 1 }} />
              Deactivate User
            </MenuItem>
            <MenuItem onClick={handleDeleteUser} sx={{ color: 'error.main' }}>
              <Delete sx={{ mr: 1 }} />
              Delete User
            </MenuItem>
          </Menu>

          {/* Deactivate User Dialog */}
          <Dialog
            open={deactivateDialogOpen}
            onClose={() => setDeactivateDialogOpen(false)}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>Deactivate User</DialogTitle>
            <DialogContent>
              <Alert severity="warning" sx={{ mb: 3 }}>
                This will deactivate the user account and prevent them from logging in.
                This action can be reversed later.
              </Alert>
              
              {selectedUser && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    User: {selectedUser.name} ({selectedUser.email})
                  </Typography>
                </Box>
              )}

              <TextField
                label="Reason for deactivation"
                multiline
                rows={3}
                fullWidth
                value={deactivateReason}
                onChange={(e) => setDeactivateReason(e.target.value)}
                placeholder="Please provide a reason for deactivating this user account..."
                required
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeactivateDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={confirmDeactivateUser}
                color="warning"
                variant="contained"
                disabled={!deactivateReason.trim()}
              >
                Deactivate User
              </Button>
            </DialogActions>
          </Dialog>
        </Box>
      </AdminLayout>
    </AuthGuard>
  );
}