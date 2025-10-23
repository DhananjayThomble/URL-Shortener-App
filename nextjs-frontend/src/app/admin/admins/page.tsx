'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  OutlinedInput,
  Alert,
  Stack,
} from '@mui/material';
import {
  Add,
  MoreVert,
  Edit,
  Delete,
  Security,
  Refresh,
} from '@mui/icons-material';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { adminAPI, type AdminUser, AdminPermission, type CreateAdminData, type UpdateAdminData } from '@/lib/api/admin';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';

const createAdminSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  permissions: z.array(z.nativeEnum(AdminPermission)).min(1, 'At least one permission is required'),
});

const updateAdminSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  permissions: z.array(z.nativeEnum(AdminPermission)).min(1, 'At least one permission is required').optional(),
  isActive: z.boolean().optional(),
});

type CreateAdminFormData = z.infer<typeof createAdminSchema>;
type UpdateAdminFormData = z.infer<typeof updateAdminSchema>;

export default function AdminManagementPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAdmin, setSelectedAdmin] = useState<AdminUser | null>(null);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<null | HTMLElement>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const {
    control: createControl,
    handleSubmit: handleCreateSubmit,
    formState: { errors: createErrors },
    reset: resetCreate,
  } = useForm<CreateAdminFormData>({
    resolver: zodResolver(createAdminSchema),
    defaultValues: {
      permissions: [],
    },
  });

  const {
    control: updateControl,
    handleSubmit: handleUpdateSubmit,
    formState: { errors: updateErrors },
    reset: resetUpdate,
  } = useForm<UpdateAdminFormData>({
    resolver: zodResolver(updateAdminSchema),
  });

  const fetchAdmins = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getAllAdmins();
      setAdmins(response.data.admins);
    } catch (error: any) {
      console.error('Failed to fetch admins:', error);
      toast.error('Failed to load admin users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  const handleActionMenuOpen = (event: React.MouseEvent<HTMLElement>, admin: AdminUser) => {
    setActionMenuAnchor(event.currentTarget);
    setSelectedAdmin(admin);
  };

  const handleActionMenuClose = () => {
    setActionMenuAnchor(null);
    setSelectedAdmin(null);
  };

  const handleCreateAdmin = () => {
    setCreateDialogOpen(true);
    resetCreate();
  };

  const handleEditAdmin = () => {
    if (selectedAdmin) {
      setEditDialogOpen(true);
      resetUpdate({
        name: selectedAdmin.name,
        permissions: selectedAdmin.permissions,
        isActive: selectedAdmin.isActive,
      });
    }
    handleActionMenuClose();
  };

  const handleDeleteAdmin = () => {
    setDeleteDialogOpen(true);
    handleActionMenuClose();
  };

  const onCreateSubmit = async (data: CreateAdminFormData) => {
    try {
      await adminAPI.createAdmin(data);
      toast.success('Admin created successfully');
      setCreateDialogOpen(false);
      resetCreate();
      fetchAdmins();
    } catch (error: any) {
      console.error('Failed to create admin:', error);
      toast.error(error.response?.data?.message || 'Failed to create admin');
    }
  };

  const onUpdateSubmit = async (data: UpdateAdminFormData) => {
    if (!selectedAdmin) return;

    try {
      await adminAPI.updateAdmin(selectedAdmin.id, data);
      toast.success('Admin updated successfully');
      setEditDialogOpen(false);
      setSelectedAdmin(null);
      fetchAdmins();
    } catch (error: any) {
      console.error('Failed to update admin:', error);
      toast.error(error.response?.data?.message || 'Failed to update admin');
    }
  };

  const confirmDeleteAdmin = async () => {
    if (!selectedAdmin) return;

    try {
      await adminAPI.deleteAdmin(selectedAdmin.id);
      toast.success('Admin deleted successfully');
      setDeleteDialogOpen(false);
      setSelectedAdmin(null);
      fetchAdmins();
    } catch (error: any) {
      console.error('Failed to delete admin:', error);
      toast.error(error.response?.data?.message || 'Failed to delete admin');
    }
  };

  const permissionLabels = {
    [AdminPermission.USER_MANAGEMENT]: 'User Management',
    [AdminPermission.URL_MANAGEMENT]: 'URL Management',
    [AdminPermission.ANALYTICS_VIEW]: 'Analytics View',
    [AdminPermission.SYSTEM_CONFIG]: 'System Config',
    [AdminPermission.AUDIT_LOGS]: 'Audit Logs',
  };

  return (
    <AuthGuard requireAuth={true} requiredRole="admin">
      <AdminLayout>
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h4" component="h1" gutterBottom>
                Admin Management
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Manage administrator accounts and permissions
              </Typography>
            </Box>
            <Stack direction="row" spacing={2}>
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={fetchAdmins}
              >
                Refresh
              </Button>
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={handleCreateAdmin}
              >
                Add Admin
              </Button>
            </Stack>
          </Box>

          <Card>
            <CardContent>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Admin</TableCell>
                      <TableCell>Permissions</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Last Login</TableCell>
                      <TableCell>Created</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          Loading admins...
                        </TableCell>
                      </TableRow>
                    ) : admins.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          No admin users found
                        </TableCell>
                      </TableRow>
                    ) : (
                      admins.map((admin) => (
                        <TableRow key={admin.id} hover>
                          <TableCell>
                            <Box>
                              <Typography variant="body2" fontWeight="medium">
                                {admin.name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {admin.email}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap">
                              {admin.permissions.map((permission) => (
                                <Chip
                                  key={permission}
                                  label={permissionLabels[permission]}
                                  size="small"
                                  variant="outlined"
                                  color="primary"
                                />
                              ))}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={admin.isActive ? 'Active' : 'Inactive'}
                              size="small"
                              color={admin.isActive ? 'success' : 'error'}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {admin.lastLoginAt
                                ? new Date(admin.lastLoginAt).toLocaleDateString()
                                : 'Never'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {new Date(admin.createdAt).toLocaleDateString()}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <IconButton
                              onClick={(e) => handleActionMenuOpen(e, admin)}
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
            </CardContent>
          </Card>

          {/* Action Menu */}
          <Menu
            anchorEl={actionMenuAnchor}
            open={Boolean(actionMenuAnchor)}
            onClose={handleActionMenuClose}
          >
            <MenuItem onClick={handleEditAdmin}>
              <Edit sx={{ mr: 1 }} />
              Edit Admin
            </MenuItem>
            <MenuItem onClick={handleDeleteAdmin} sx={{ color: 'error.main' }}>
              <Delete sx={{ mr: 1 }} />
              Delete Admin
            </MenuItem>
          </Menu>

          {/* Create Admin Dialog */}
          <Dialog
            open={createDialogOpen}
            onClose={() => setCreateDialogOpen(false)}
            maxWidth="sm"
            fullWidth
          >
            <form onSubmit={handleCreateSubmit(onCreateSubmit)}>
              <DialogTitle>Create New Admin</DialogTitle>
              <DialogContent>
                <Stack spacing={3} sx={{ mt: 1 }}>
                  <Controller
                    name="name"
                    control={createControl}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Full Name"
                        error={!!createErrors.name}
                        helperText={createErrors.name?.message}
                        fullWidth
                      />
                    )}
                  />

                  <Controller
                    name="email"
                    control={createControl}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Email Address"
                        type="email"
                        error={!!createErrors.email}
                        helperText={createErrors.email?.message}
                        fullWidth
                      />
                    )}
                  />

                  <Controller
                    name="password"
                    control={createControl}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Password"
                        type="password"
                        error={!!createErrors.password}
                        helperText={createErrors.password?.message}
                        fullWidth
                      />
                    )}
                  />

                  <Controller
                    name="permissions"
                    control={createControl}
                    render={({ field }) => (
                      <FormControl fullWidth error={!!createErrors.permissions}>
                        <InputLabel>Permissions</InputLabel>
                        <Select
                          {...field}
                          multiple
                          input={<OutlinedInput label="Permissions" />}
                          renderValue={(selected) => (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {selected.map((value) => (
                                <Chip key={value} label={permissionLabels[value]} size="small" />
                              ))}
                            </Box>
                          )}
                        >
                          {Object.values(AdminPermission).map((permission) => (
                            <MenuItem key={permission} value={permission}>
                              {permissionLabels[permission]}
                            </MenuItem>
                          ))}
                        </Select>
                        {createErrors.permissions && (
                          <Typography variant="caption" color="error" sx={{ mt: 1, ml: 2 }}>
                            {createErrors.permissions.message}
                          </Typography>
                        )}
                      </FormControl>
                    )}
                  />
                </Stack>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="contained">
                  Create Admin
                </Button>
              </DialogActions>
            </form>
          </Dialog>

          {/* Edit Admin Dialog */}
          <Dialog
            open={editDialogOpen}
            onClose={() => setEditDialogOpen(false)}
            maxWidth="sm"
            fullWidth
          >
            <form onSubmit={handleUpdateSubmit(onUpdateSubmit)}>
              <DialogTitle>Edit Admin</DialogTitle>
              <DialogContent>
                <Stack spacing={3} sx={{ mt: 1 }}>
                  <Controller
                    name="name"
                    control={updateControl}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Full Name"
                        error={!!updateErrors.name}
                        helperText={updateErrors.name?.message}
                        fullWidth
                      />
                    )}
                  />

                  <Controller
                    name="permissions"
                    control={updateControl}
                    render={({ field }) => (
                      <FormControl fullWidth error={!!updateErrors.permissions}>
                        <InputLabel>Permissions</InputLabel>
                        <Select
                          {...field}
                          multiple
                          input={<OutlinedInput label="Permissions" />}
                          renderValue={(selected) => (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {(selected || []).map((value) => (
                                <Chip key={value} label={permissionLabels[value]} size="small" />
                              ))}
                            </Box>
                          )}
                        >
                          {Object.values(AdminPermission).map((permission) => (
                            <MenuItem key={permission} value={permission}>
                              {permissionLabels[permission]}
                            </MenuItem>
                          ))}
                        </Select>
                        {updateErrors.permissions && (
                          <Typography variant="caption" color="error" sx={{ mt: 1, ml: 2 }}>
                            {updateErrors.permissions.message}
                          </Typography>
                        )}
                      </FormControl>
                    )}
                  />

                  <Controller
                    name="isActive"
                    control={updateControl}
                    render={({ field }) => (
                      <FormControl fullWidth>
                        <InputLabel>Status</InputLabel>
                        <Select
                          {...field}
                          value={field.value?.toString() || 'true'}
                          onChange={(e) => field.onChange(e.target.value === 'true')}
                          input={<OutlinedInput label="Status" />}
                        >
                          <MenuItem value="true">Active</MenuItem>
                          <MenuItem value="false">Inactive</MenuItem>
                        </Select>
                      </FormControl>
                    )}
                  />
                </Stack>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="contained">
                  Update Admin
                </Button>
              </DialogActions>
            </form>
          </Dialog>

          {/* Delete Admin Dialog */}
          <Dialog
            open={deleteDialogOpen}
            onClose={() => setDeleteDialogOpen(false)}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>Delete Admin</DialogTitle>
            <DialogContent>
              <Alert severity="error" sx={{ mb: 2 }}>
                This action cannot be undone. The admin user will be permanently deleted.
              </Alert>
              
              {selectedAdmin && (
                <Typography variant="body1">
                  Are you sure you want to delete the admin user <strong>{selectedAdmin.name}</strong> ({selectedAdmin.email})?
                </Typography>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={confirmDeleteAdmin}
                color="error"
                variant="contained"
              >
                Delete Admin
              </Button>
            </DialogActions>
          </Dialog>
        </Box>
      </AdminLayout>
    </AuthGuard>
  );
}