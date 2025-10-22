'use client';
import { forwardRef } from 'react';
import {
  Box,
  Grid,
  Stack,
  Typography,
  Divider,
  Card,
  CardContent,
  CardHeader,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { styled } from '@mui/material/styles';
import { tokens } from '@/lib/theme/tokens';

export type FormLayoutVariant = 'default' | 'card' | 'steps' | 'accordion' | 'sidebar';
export type FormLayoutSpacing = 'compact' | 'normal' | 'comfortable';

export interface FormSection {
  id: string;
  title?: string;
  description?: string;
  children: React.ReactNode;
  disabled?: boolean;
  error?: boolean;
  completed?: boolean;
  optional?: boolean;
}

export interface FormLayoutProps {
  variant?: FormLayoutVariant;
  spacing?: FormLayoutSpacing;
  sections?: FormSection[];
  children?: React.ReactNode;
  title?: string;
  description?: string;
  maxWidth?: number | string;
  fullWidth?: boolean;
  activeStep?: number;
  onStepChange?: (step: number) => void;
  sidebarContent?: React.ReactNode;
  sidebarWidth?: number;
}

// Styled components
const FormContainer = styled(Box, {
  shouldForwardProp: (prop) => !['spacing', 'maxWidth'].includes(prop as string),
})<{ spacing?: FormLayoutSpacing; maxWidth?: number | string }>(
  ({ theme, spacing = 'normal', maxWidth }) => ({
    width: '100%',
    maxWidth: maxWidth || 'none',
    margin: '0 auto',
    padding: {
      compact: theme.spacing(1),
      normal: theme.spacing(2),
      comfortable: theme.spacing(3),
    }[spacing],
  })
);

const SidebarLayout = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(3),
  [theme.breakpoints.down('md')]: {
    flexDirection: 'column',
  },
}));

const SidebarContent = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'width',
})<{ width?: number }>(({ theme, width = 300 }) => ({
  width: width,
  flexShrink: 0,
  [theme.breakpoints.down('md')]: {
    width: '100%',
  },
}));

const MainContent = styled(Box)(() => ({
  flex: 1,
  minWidth: 0,
}));

export const FormLayout = forwardRef<HTMLDivElement, FormLayoutProps>(
  (
    {
      variant = 'default',
      spacing = 'normal',
      sections = [],
      children,
      title,
      description,
      maxWidth,
      fullWidth = false,
      activeStep = 0,
      onStepChange,
      sidebarContent,
      sidebarWidth = 300,
      ...props
    },
    ref
  ) => {
    // Render form header
    const renderHeader = () => {
      if (!title && !description) return null;
      
      return (
        <Box sx={{ mb: 3 }}>
          {title && (
            <Typography variant="h4" component="h1" gutterBottom>
              {title}
            </Typography>
          )}
          {description && (
            <Typography variant="body1" color="text.secondary">
              {description}
            </Typography>
          )}
          <Divider sx={{ mt: 2 }} />
        </Box>
      );
    };

    // Render default layout
    const renderDefault = () => (
      <Stack spacing={3}>
        {sections.map((section) => (
          <Box key={section.id}>
            {section.title && (
              <Typography variant="h6" gutterBottom>
                {section.title}
                {section.optional && (
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                    (Optional)
                  </Typography>
                )}
              </Typography>
            )}
            {section.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {section.description}
              </Typography>
            )}
            <Box sx={{ opacity: section.disabled ? 0.6 : 1 }}>
              {section.children}
            </Box>
          </Box>
        ))}
        {children}
      </Stack>
    );

    // Render card layout
    const renderCard = () => (
      <Stack spacing={2}>
        {sections.map((section) => (
          <Card 
            key={section.id}
            variant="outlined"
            sx={{ 
              borderColor: section.error ? 'error.main' : undefined,
              opacity: section.disabled ? 0.6 : 1,
            }}
          >
            {(section.title || section.description) && (
              <CardHeader
                title={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {section.title}
                    {section.optional && (
                      <Typography variant="body2" color="text.secondary">
                        (Optional)
                      </Typography>
                    )}
                  </Box>
                }
                subheader={section.description}
              />
            )}
            <CardContent>
              {section.children}
            </CardContent>
          </Card>
        ))}
        {children && (
          <Card variant="outlined">
            <CardContent>
              {children}
            </CardContent>
          </Card>
        )}
      </Stack>
    );

    // Render steps layout
    const renderSteps = () => (
      <Stepper activeStep={activeStep} orientation="vertical">
        {sections.map((section, index) => (
          <Step key={section.id} completed={section.completed}>
            <StepLabel
              optional={section.optional ? (
                <Typography variant="caption">Optional</Typography>
              ) : null}
              error={section.error}
            >
              {section.title || `Step ${index + 1}`}
            </StepLabel>
            <StepContent>
              {section.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {section.description}
                </Typography>
              )}
              <Box sx={{ opacity: section.disabled ? 0.6 : 1 }}>
                {section.children}
              </Box>
            </StepContent>
          </Step>
        ))}
      </Stepper>
    );

    // Render accordion layout
    const renderAccordion = () => (
      <Box>
        {sections.map((section, index) => (
          <Accordion 
            key={section.id}
            defaultExpanded={index === 0}
            disabled={section.disabled}
          >
            <AccordionSummary
              expandIcon={<ExpandMore />}
              sx={{
                backgroundColor: section.error ? 'error.light' : undefined,
                '&.Mui-expanded': {
                  backgroundColor: section.error ? 'error.light' : 'action.hover',
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                <Typography variant="h6">
                  {section.title || `Section ${index + 1}`}
                </Typography>
                {section.optional && (
                  <Typography variant="body2" color="text.secondary">
                    (Optional)
                  </Typography>
                )}
                {section.completed && (
                  <Typography variant="body2" color="success.main">
                    ✓ Completed
                  </Typography>
                )}
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {section.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {section.description}
                </Typography>
              )}
              {section.children}
            </AccordionDetails>
          </Accordion>
        ))}
        {children && (
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="h6">Additional Content</Typography>
            </AccordionSummary>
            <AccordionDetails>
              {children}
            </AccordionDetails>
          </Accordion>
        )}
      </Box>
    );

    // Render sidebar layout
    const renderSidebar = () => (
      <SidebarLayout>
        {sidebarContent && (
          <SidebarContent width={sidebarWidth}>
            {sidebarContent}
          </SidebarContent>
        )}
        <MainContent>
          {renderDefault()}
        </MainContent>
      </SidebarLayout>
    );

    // Render content based on variant
    const renderContent = () => {
      switch (variant) {
        case 'card':
          return renderCard();
        case 'steps':
          return renderSteps();
        case 'accordion':
          return renderAccordion();
        case 'sidebar':
          return renderSidebar();
        default:
          return renderDefault();
      }
    };

    return (
      <FormContainer
        ref={ref}
        spacing={spacing}
        maxWidth={fullWidth ? '100%' : maxWidth}
        {...props}
      >
        {renderHeader()}
        {renderContent()}
      </FormContainer>
    );
  }
);

FormLayout.displayName = 'FormLayout';

export default FormLayout;