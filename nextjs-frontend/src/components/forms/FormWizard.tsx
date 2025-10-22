'use client';

import { useState, useCallback, Children, isValidElement, cloneElement } from 'react';
import {
  Box,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Button,
  Typography,
  Paper,
  LinearProgress,
  Alert,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { ArrowBack, ArrowForward, Check } from '@mui/icons-material';
import { tokens } from '@/lib/theme/tokens';

export interface FormWizardStep {
  label: string;
  description?: string;
  optional?: boolean;
  component: React.ReactNode;
  validation?: () => boolean | Promise<boolean>;
}

export interface FormWizardProps {
  steps: FormWizardStep[];
  onComplete: (data: any) => void | Promise<void>;
  onStepChange?: (step: number) => void;
  orientation?: 'horizontal' | 'vertical';
  showProgress?: boolean;
  allowSkip?: boolean;
  loading?: boolean;
  error?: string;
  className?: string;
}

// Styled components
const WizardContainer = styled(Box)(({ theme }) => ({
  width: '100%',
  maxWidth: 800,
  margin: '0 auto',
}));

const StepContentContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  minHeight: 200,
}));

const ActionButtons = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: theme.spacing(2),
  borderTop: `1px solid ${theme.palette.divider}`,
  backgroundColor: theme.palette.background.paper,
}));

export const FormWizard: React.FC<FormWizardProps> = ({
  steps,
  onComplete,
  onStepChange,
  orientation = 'horizontal',
  showProgress = true,
  allowSkip = false,
  loading = false,
  error,
  className,
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [stepData, setStepData] = useState<Record<number, any>>({});
  const [isValidating, setIsValidating] = useState(false);

  // Calculate progress
  const progress = ((activeStep + 1) / steps.length) * 100;

  // Handle step navigation
  const handleNext = useCallback(async () => {
    const currentStep = steps[activeStep];
    
    if (currentStep.validation) {
      setIsValidating(true);
      try {
        const isValid = await currentStep.validation();
        if (!isValid) {
          setIsValidating(false);
          return;
        }
      } catch (error) {
        console.error('Step validation error:', error);
        setIsValidating(false);
        return;
      }
      setIsValidating(false);
    }

    // Mark current step as completed
    setCompletedSteps(prev => new Set([...prev, activeStep]));

    if (activeStep === steps.length - 1) {
      // Last step - complete the wizard
      await handleComplete();
    } else {
      // Move to next step
      const nextStep = activeStep + 1;
      setActiveStep(nextStep);
      onStepChange?.(nextStep);
    }
  }, [activeStep, steps, onStepChange]);

  const handleBack = useCallback(() => {
    if (activeStep > 0) {
      const prevStep = activeStep - 1;
      setActiveStep(prevStep);
      onStepChange?.(prevStep);
    }
  }, [activeStep, onStepChange]);

  const handleStepClick = useCallback((step: number) => {
    // Allow clicking on completed steps or the next step
    if (completedSteps.has(step) || step === activeStep + 1) {
      setActiveStep(step);
      onStepChange?.(step);
    }
  }, [activeStep, completedSteps, onStepChange]);

  const handleSkip = useCallback(() => {
    if (allowSkip && !steps[activeStep].optional === false) {
      const nextStep = activeStep + 1;
      if (nextStep < steps.length) {
        setActiveStep(nextStep);
        onStepChange?.(nextStep);
      }
    }
  }, [activeStep, allowSkip, steps, onStepChange]);

  const handleComplete = useCallback(async () => {
    try {
      // Collect all step data
      const allData = Object.values(stepData).reduce((acc, data) => ({ ...acc, ...data }), {});
      await onComplete(allData);
    } catch (error) {
      console.error('Wizard completion error:', error);
    }
  }, [stepData, onComplete]);

  // Update step data
  const updateStepData = useCallback((step: number, data: any) => {
    setStepData(prev => ({ ...prev, [step]: data }));
  }, []);

  // Check if current step is completed
  const isStepCompleted = (step: number) => completedSteps.has(step);

  // Check if step is accessible
  const isStepAccessible = (step: number) => {
    return step <= activeStep || completedSteps.has(step);
  };

  // Render step content with data injection
  const renderStepContent = (step: FormWizardStep, stepIndex: number) => {
    if (!isValidElement(step.component)) {
      return step.component;
    }

    // Pass basic wizard state as props - components can use them if needed
    const additionalProps: any = {
      isActive: stepIndex === activeStep,
      isCompleted: isStepCompleted(stepIndex),
      // Optional props that form components can use
      onDataChange: (data: any) => updateStepData(stepIndex, data),
      stepData: stepData[stepIndex],
    };

    return cloneElement(step.component as React.ReactElement, additionalProps);
  };

  return (
    <WizardContainer className={className}>
      {/* Progress Bar */}
      {showProgress && (
        <Box sx={{ mb: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Step {activeStep + 1} of {steps.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {Math.round(progress)}% Complete
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: 8,
              borderRadius: 4,
              backgroundColor: 'action.hover',
              '& .MuiLinearProgress-bar': {
                borderRadius: 4,
              },
            }}
          />
        </Box>
      )}

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Stepper */}
      <Paper elevation={1} sx={{ mb: 3 }}>
        <Stepper 
          activeStep={activeStep} 
          orientation={orientation}
          sx={{ p: 2 }}
        >
          {steps.map((step, index) => (
            <Step 
              key={step.label} 
              completed={isStepCompleted(index)}
              onClick={() => handleStepClick(index)}
              sx={{ 
                cursor: isStepAccessible(index) ? 'pointer' : 'default',
                '& .MuiStepLabel-root': {
                  cursor: 'inherit',
                },
              }}
            >
              <StepLabel
                optional={
                  step.optional ? (
                    <Typography variant="caption">Optional</Typography>
                  ) : undefined
                }
                StepIconComponent={({ completed, active }) => (
                  <Box
                    sx={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: completed 
                        ? 'success.main' 
                        : active 
                        ? 'primary.main' 
                        : 'action.disabled',
                      color: completed || active ? 'white' : 'text.disabled',
                      fontSize: '0.875rem',
                      fontWeight: 'medium',
                    }}
                  >
                    {completed ? <Check fontSize="small" /> : index + 1}
                  </Box>
                )}
              >
                <Typography variant="body2" fontWeight={activeStep === index ? 'medium' : 'normal'}>
                  {step.label}
                </Typography>
                {step.description && (
                  <Typography variant="caption" color="text.secondary">
                    {step.description}
                  </Typography>
                )}
              </StepLabel>
              
              {orientation === 'vertical' && (
                <StepContent>
                  {renderStepContent(step, index)}
                </StepContent>
              )}
            </Step>
          ))}
        </Stepper>
      </Paper>

      {/* Step Content (for horizontal orientation) */}
      {orientation === 'horizontal' && (
        <Paper elevation={1}>
          <StepContentContainer>
            {renderStepContent(steps[activeStep], activeStep)}
          </StepContentContainer>

          {/* Action Buttons */}
          <ActionButtons>
            <Box>
              <Button
                onClick={handleBack}
                disabled={activeStep === 0 || loading || isValidating}
                startIcon={<ArrowBack />}
                sx={{ mr: 1 }}
              >
                Back
              </Button>
              
              {allowSkip && steps[activeStep].optional && (
                <Button
                  onClick={handleSkip}
                  disabled={loading || isValidating}
                  color="inherit"
                >
                  Skip
                </Button>
              )}
            </Box>

            <Button
              variant="contained"
              onClick={handleNext}
              disabled={loading || isValidating}
              endIcon={
                activeStep === steps.length - 1 ? <Check /> : <ArrowForward />
              }
            >
              {isValidating 
                ? 'Validating...' 
                : activeStep === steps.length - 1 
                ? 'Complete' 
                : 'Next'
              }
            </Button>
          </ActionButtons>
        </Paper>
      )}

      {/* Loading Overlay */}
      {loading && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <Typography>Processing...</Typography>
        </Box>
      )}
    </WizardContainer>
  );
};

export default FormWizard;