'use client';

import React, { useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Tabs,
  Tab,
  Paper,
} from '@mui/material';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { AnalyticsExample } from '@/components/examples/AnalyticsExample';
import { UIComponentsExample } from '@/components/examples/UIComponentsExample';
import { AuthenticationExample } from '@/components/examples/AuthenticationExample';
import { FormsExample } from '@/components/examples/FormsExample';
import { AdvancedFormsExample } from '@/components/examples/AdvancedFormsExample';
import { ThemeExample } from '@/components/examples/ThemeExample';
import { UrlManagementExample } from '@/components/examples/UrlManagementExample';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`example-tabpanel-${index}`}
      aria-labelledby={`example-tab-${index}`}
      {...other}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
}

export default function ExamplesPage() {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const examples = [
    { label: 'Analytics', component: <AnalyticsExample /> },
    { label: 'UI Components', component: <UIComponentsExample /> },
    { label: 'Authentication', component: <AuthenticationExample /> },
    { label: 'Forms', component: <FormsExample /> },
    { label: 'Advanced Forms', component: <AdvancedFormsExample /> },
    { label: 'Theme', component: <ThemeExample /> },
    { label: 'URL Management', component: <UrlManagementExample /> },
  ];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <Box
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          py: 2,
        }}
      >
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h5" component="h1" fontWeight="bold">
              SnapURL - Component Examples
            </Typography>
            <ThemeToggle />
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Paper sx={{ width: '100%' }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs
              value={tabValue}
              onChange={handleTabChange}
              variant="scrollable"
              scrollButtons="auto"
              aria-label="component examples tabs"
            >
              {examples.map((example, index) => (
                <Tab key={index} label={example.label} />
              ))}
            </Tabs>
          </Box>

          {examples.map((example, index) => (
            <TabPanel key={index} value={tabValue} index={index}>
              {example.component}
            </TabPanel>
          ))}
        </Paper>
      </Container>
    </Box>
  );
}