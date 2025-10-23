'use client';

import { useState } from 'react';
import { Box, Container, Typography, Tabs, Tab } from '@mui/material';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AuthenticatedLayout } from '@/components/layout/AuthenticatedLayout';
import {
  ProfileSettings,
  SecuritySettings,
  NotificationSettings,
  AccountSettings,
} from '@/components/profile';
import {
  Person,
  Security,
  Notifications,
  Settings,
} from '@mui/icons-material';

type ProfileTab = 'profile' | 'security' | 'notifications' | 'account';

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile');

  const handleTabChange = (event: React.SyntheticEvent, newValue: ProfileTab) => {
    setActiveTab(newValue);
  };

  const tabs = [
    { value: 'profile', label: 'Profile', icon: <Person /> },
    { value: 'security', label: 'Security', icon: <Security /> },
    { value: 'notifications', label: 'Notifications', icon: <Notifications /> },
    { value: 'account', label: 'Account', icon: <Settings /> },
  ];

  return (
    <AuthGuard requireAuth={true}>
      <AuthenticatedLayout>
        <Container maxWidth="lg" sx={{ py: 3 }}>
          <Box sx={{ mb: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom>
              Profile Settings
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Manage your account settings and preferences
            </Typography>
          </Box>

          {/* Profile Tabs */}
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs value={activeTab} onChange={handleTabChange}>
              {tabs.map((tab) => (
                <Tab
                  key={tab.value}
                  label={tab.label}
                  value={tab.value}
                  icon={tab.icon}
                  iconPosition="start"
                />
              ))}
            </Tabs>
          </Box>

          {/* Tab Content */}
          <Box>
            {activeTab === 'profile' && <ProfileSettings />}
            {activeTab === 'security' && <SecuritySettings />}
            {activeTab === 'notifications' && <NotificationSettings />}
            {activeTab === 'account' && <AccountSettings />}
          </Box>
        </Container>
      </AuthenticatedLayout>
    </AuthGuard>
  );
}