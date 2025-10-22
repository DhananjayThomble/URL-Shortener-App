'use client';
import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  Chip,
  Alert,
  Paper,
  Divider,
} from '@mui/material';
import { z } from 'zod';
import {
  FormLayout,
  FormArray,
  FileUpload,
  DateTimePicker,
} from '@/components/forms';
import { TextField } from '@mui/material';
import { useAdvancedForm } from '@/hooks/useAdvancedForm';
import { ValidationRules } from '../../lib/validation/rules';

// Example schemas
const ContactSchema = z.object({
  name: ValidationRules.username(),
  email: ValidationRules.email(),
  phone: ValidationRules.phone().optional(),
  birthDate: z.date().optional(),
  avatar: z.instanceof(File).optional(),
});

const ProjectSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  startDate: z.date(),
  endDate: z.date(),
  budget: z.number().min(0, 'Budget must be positive'),
  tags: z.array(z.string()).min(1, 'At least one tag is required'),
  attachments: z.array(z.instanceof(File)).max(5, 'Maximum 5 files allowed'),
  contacts: z.array(ContactSchema).min(1, 'At least one contact is required'),
});

type ProjectFormData = z.infer<typeof ProjectSchema>;

export function AdvancedFormsExample() {
  const [activeExample, setActiveExample] = useState<'layout' | 'array' | 'upload' | 'datetime' | 'advanced'>('layout');

  // Layout Example
  const LayoutExample = () => {
    const sections = [
      {
        id: 'basic',
        title: 'Basic Information',
        description: 'Enter your basic project details',
        children: (
          <Stack spacing={2}>
            <TextField name="title" label="Project Title" required fullWidth />
            <TextField name="description" label="Description" multiline rows={3} fullWidth />
          </Stack>
        ),
      },
      {
        id: 'dates',
        title: 'Timeline',
        description: 'Set project start and end dates',
        children: (
          <Stack spacing={2}>
            <DateTimePicker label="Start Date" variant="date" />
            <DateTimePicker label="End Date" variant="date" />
          </Stack>
        ),
      },
      {
        id: 'budget',
        title: 'Budget',
        description: 'Project budget information',
        optional: true,
        children: (
          <TextField name="budget" label="Budget ($)" type="number" fullWidth />
        ),
      },
    ];

    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Form Layout Variants
        </Typography>
        <Stack spacing={3}>
          <FormLayout
            variant="card"
            title="Project Setup"
            description="Create a new project with all necessary details"
            sections={sections}
          />
        </Stack>
      </Box>
    );
  };

  // Array Example
  const ArrayExample = () => {
    const [contacts, setContacts] = useState([
      {
        id: '1',
        data: { name: 'John Doe', email: 'john@example.com', phone: '+1234567890' },
      },
    ]);

    const createNewContact = () => ({
      data: { name: '', email: '', phone: '' },
    });

    const renderContactItem = (item: any, index: number, handlers: any) => (
      <Stack spacing={2}>
        <TextField
          name={`contacts.${index}.name`}
          label="Name"
          value={item.data.name}
          onChange={(e: any) => handlers.updateItem({ name: e.target.value })}
          required
          fullWidth
        />
        <TextField
          name={`contacts.${index}.email`}
          label="Email"
          type="email"
          value={item.data.email}
          onChange={(e: any) => handlers.updateItem({ email: e.target.value })}
          required
          fullWidth
        />
        <TextField
          name={`contacts.${index}.phone`}
          label="Phone"
          value={item.data.phone}
          onChange={(e: any) => handlers.updateItem({ phone: e.target.value })}
          fullWidth
        />
      </Stack>
    );

    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Dynamic Form Arrays
        </Typography>
        <FormArray
          items={contacts}
          onChange={setContacts}
          renderItem={renderContactItem}
          createNewItem={createNewContact}
          title="Project Contacts"
          description="Add team members and stakeholders"
          addButtonText="Add Contact"
          maxItems={10}
          collapsible
          sortable
        />
      </Box>
    );
  };

  // File Upload Example
  const FileUploadExample = () => {
    const [files, setFiles] = useState<File[]>([]);

    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          File Upload Components
        </Typography>
        <Stack spacing={3}>
          <FileUpload
            variant="dropzone"
            multiple
            maxFiles={5}
            maxSize={10}
            value={files}
            onChange={setFiles}
            allowedTypes={['image/*', 'application/pdf', 'text/*']}
            helperText="Upload images, PDFs, or text files (max 10MB each)"
          />
          
          <FileUpload
            variant="button"
            accept="image/*"
            maxSize={5}
            helperText="Profile picture (max 5MB)"
          />
          
          <FileUpload
            variant="compact"
            multiple
            maxFiles={3}
            helperText="Quick upload"
          />
        </Stack>
      </Box>
    );
  };

  // DateTime Picker Example
  const DateTimeExample = () => {
    const [date, setDate] = useState<Date | null>(null);
    const [time, setTime] = useState<Date | null>(null);
    const [datetime, setDatetime] = useState<Date | null>(null);

    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Date & Time Pickers
        </Typography>
        <Stack spacing={3}>
          <DateTimePicker
            variant="date"
            label="Select Date"
            value={date}
            onChange={setDate}
            disablePast
          />
          
          <DateTimePicker
            variant="time"
            label="Select Time"
            value={time}
            onChange={setTime}
          />
          
          <DateTimePicker
            variant="datetime"
            label="Select Date & Time"
            value={datetime}
            onChange={setDatetime}
            minDate={new Date()}
          />
        </Stack>
      </Box>
    );
  };

  // Advanced Form Hook Example
  const AdvancedFormExample = () => {
    const [formState, formActions] = useAdvancedForm<ProjectFormData>({
      initialValues: {
        title: '',
        description: '',
        startDate: new Date(),
        endDate: new Date(),
        budget: 0,
        tags: [],
        attachments: [],
        contacts: [],
      },
      validationSchema: ProjectSchema,
      validateOnChange: true,
      validateOnBlur: true,
      enableAutoSave: true,
      autoSaveKey: 'project-form',
      onSubmit: async (values) => {
        console.log('Submitting:', values);
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 2000));
        alert('Form submitted successfully!');
      },
    });

    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Advanced Form Management
        </Typography>
        
        {/* Form State Display */}
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
          <Typography variant="subtitle2" gutterBottom>
            Form State:
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Chip 
              label={`Valid: ${formState.isValid}`} 
              color={formState.isValid ? 'success' : 'error'} 
              size="small" 
            />
            <Chip 
              label={`Dirty: ${formState.isDirty}`} 
              color={formState.isDirty ? 'warning' : 'default'} 
              size="small" 
            />
            <Chip 
              label={`Submitting: ${formState.isSubmitting}`} 
              color={formState.isSubmitting ? 'info' : 'default'} 
              size="small" 
            />
            <Chip 
              label={`Submit Count: ${formState.submitCount}`} 
              size="small" 
            />
          </Stack>
        </Paper>

        {/* Form Errors */}
        {Object.keys(formState.errors).length > 0 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="subtitle2">Form Errors:</Typography>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {Object.entries(formState.errors).map(([field, error]) => (
                <li key={field}>{field}: {error}</li>
              ))}
            </ul>
          </Alert>
        )}

        {/* Form Fields */}
        <Stack spacing={3}>
          <TextField
            name="title"
            label="Project Title"
            value={formState.fields.title?.value || ''}
            onChange={(e: any) => formActions.setFieldValue('title', e.target.value)}
            onBlur={() => formActions.setFieldTouched('title')}
            error={Boolean(formState.fields.title?.error)}
            helperText={formState.fields.title?.error}
            required
            fullWidth
          />
          
          <TextField
            name="description"
            label="Description"
            multiline
            rows={3}
            value={formState.fields.description?.value || ''}
            onChange={(e: any) => formActions.setFieldValue('description', e.target.value)}
            onBlur={() => formActions.setFieldTouched('description')}
            error={Boolean(formState.fields.description?.error)}
            helperText={formState.fields.description?.error}
            required
            fullWidth
          />

          <TextField
            name="budget"
            label="Budget ($)"
            type="number"
            value={formState.fields.budget?.value || 0}
            onChange={(e: any) => formActions.setFieldValue('budget', Number(e.target.value))}
            onBlur={() => formActions.setFieldTouched('budget')}
            error={Boolean(formState.fields.budget?.error)}
            helperText={formState.fields.budget?.error}
            fullWidth
          />

          {/* Action Buttons */}
          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              onClick={formActions.submitForm}
              disabled={formState.isSubmitting}
            >
              {formState.isSubmitting ? 'Submitting...' : 'Submit'}
            </Button>
            <Button
              variant="outlined"
              onClick={() => formActions.resetForm()}
              disabled={formState.isSubmitting}
            >
              Reset
            </Button>
            <Button
              variant="text"
              onClick={formActions.clearErrors}
              disabled={Object.keys(formState.errors).length === 0}
            >
              Clear Errors
            </Button>
          </Stack>
        </Stack>
      </Box>
    );
  };

  const examples = {
    layout: <LayoutExample />,
    array: <ArrayExample />,
    upload: <FileUploadExample />,
    datetime: <DateTimeExample />,
    advanced: <AdvancedFormExample />,
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Advanced Form Components
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Comprehensive form system with advanced validation, layouts, and user experience features.
      </Typography>

      {/* Example Navigation */}
      <Stack direction="row" spacing={1} sx={{ mb: 3 }} flexWrap="wrap">
        {Object.keys(examples).map((key) => (
          <Button
            key={key}
            variant={activeExample === key ? 'contained' : 'outlined'}
            onClick={() => setActiveExample(key as any)}
            size="small"
          >
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </Button>
        ))}
      </Stack>

      <Divider sx={{ mb: 3 }} />

      {/* Active Example */}
      {examples[activeExample]}
    </Box>
  );
}

export default AdvancedFormsExample;