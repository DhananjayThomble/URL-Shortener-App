import { z } from 'zod';
import type { SelectOption } from '@/components/ui';

// Field types
export type FormFieldType = 
  | 'text' 
  | 'email' 
  | 'password' 
  | 'number' 
  | 'tel' 
  | 'url' 
  | 'textarea' 
  | 'select' 
  | 'multiselect'
  | 'checkbox' 
  | 'radio' 
  | 'date' 
  | 'time' 
  | 'datetime'
  | 'file'
  | 'hidden';

// Field configuration
export interface FormFieldConfig {
  name: string;
  type: FormFieldType;
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  
  // Validation
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  customValidation?: (value: any) => string | null;
  
  // Options for select/radio fields
  options?: SelectOption[];
  
  // Layout
  fullWidth?: boolean;
  size?: 'small' | 'medium' | 'large';
  grid?: {
    xs?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
  
  // Conditional display
  showWhen?: {
    field: string;
    value: any;
    operator?: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
  };
  
  // Additional props
  props?: Record<string, any>;
}

// Form section configuration
export interface FormSectionConfig {
  title?: string;
  description?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  fields: FormFieldConfig[];
}

// Complete form configuration
export interface FormConfig {
  title?: string;
  description?: string;
  sections?: FormSectionConfig[];
  fields?: FormFieldConfig[];
  submitLabel?: string;
  resetLabel?: string;
  showReset?: boolean;
  showProgress?: boolean;
  autoSave?: boolean;
  validation?: {
    validateOnChange?: boolean;
    validateOnBlur?: boolean;
    debounceMs?: number;
  };
}

// Form builder class
export class FormBuilder {
  private config: FormConfig;
  private schema: z.ZodObject<any> | null = null;

  constructor(config: FormConfig) {
    this.config = config;
    this.generateSchema();
  }

  // Generate Zod schema from field configurations
  private generateSchema(): void {
    const allFields = this.getAllFields();
    const schemaFields: Record<string, z.ZodTypeAny> = {};

    allFields.forEach(field => {
      let fieldSchema: z.ZodTypeAny;

      // Base schema based on field type
      switch (field.type) {
        case 'email':
          fieldSchema = z.string().email('Invalid email address');
          break;
        case 'url':
          fieldSchema = z.string().url('Invalid URL');
          break;
        case 'number':
          fieldSchema = z.number();
          break;
        case 'date':
        case 'time':
        case 'datetime':
          fieldSchema = z.date();
          break;
        case 'checkbox':
          fieldSchema = z.boolean();
          break;
        case 'multiselect':
          fieldSchema = z.array(z.string());
          break;
        case 'file':
          fieldSchema = z.instanceof(File);
          break;
        default:
          fieldSchema = z.string();
      }

      // Apply validation rules
      if (field.type === 'text' || field.type === 'email' || field.type === 'password' || field.type === 'textarea') {
        if (field.minLength) {
          fieldSchema = (fieldSchema as z.ZodString).min(field.minLength, `Minimum ${field.minLength} characters required`);
        }
        if (field.maxLength) {
          fieldSchema = (fieldSchema as z.ZodString).max(field.maxLength, `Maximum ${field.maxLength} characters allowed`);
        }
        if (field.pattern) {
          fieldSchema = (fieldSchema as z.ZodString).regex(field.pattern, 'Invalid format');
        }
      }

      if (field.type === 'number') {
        if (field.min !== undefined) {
          fieldSchema = (fieldSchema as z.ZodNumber).min(field.min, `Minimum value is ${field.min}`);
        }
        if (field.max !== undefined) {
          fieldSchema = (fieldSchema as z.ZodNumber).max(field.max, `Maximum value is ${field.max}`);
        }
      }

      // Handle required/optional
      if (!field.required) {
        fieldSchema = fieldSchema.optional();
      }

      // Add custom validation
      if (field.customValidation) {
        fieldSchema = fieldSchema.refine(
          (value) => {
            const error = field.customValidation!(value);
            return error === null;
          },
          (value) => ({
            message: field.customValidation!(value) || 'Invalid value',
          })
        );
      }

      schemaFields[field.name] = fieldSchema;
    });

    this.schema = z.object(schemaFields);
  }

  // Get all fields from sections and root level
  private getAllFields(): FormFieldConfig[] {
    const fields: FormFieldConfig[] = [];
    
    if (this.config.fields) {
      fields.push(...this.config.fields);
    }
    
    if (this.config.sections) {
      this.config.sections.forEach(section => {
        fields.push(...section.fields);
      });
    }
    
    return fields;
  }

  // Get generated schema
  getSchema(): z.ZodObject<any> | null {
    return this.schema;
  }

  // Get form configuration
  getConfig(): FormConfig {
    return this.config;
  }

  // Get default values
  getDefaultValues(): Record<string, any> {
    const defaults: Record<string, any> = {};
    const allFields = this.getAllFields();

    allFields.forEach(field => {
      switch (field.type) {
        case 'checkbox':
          defaults[field.name] = false;
          break;
        case 'multiselect':
          defaults[field.name] = [];
          break;
        case 'number':
          defaults[field.name] = field.min || 0;
          break;
        default:
          defaults[field.name] = '';
      }
    });

    return defaults;
  }

  // Check if field should be shown based on conditions
  shouldShowField(field: FormFieldConfig, formData: Record<string, any>): boolean {
    if (!field.showWhen) return true;

    const { field: dependentField, value: expectedValue, operator = 'equals' } = field.showWhen;
    const actualValue = formData[dependentField];

    switch (operator) {
      case 'equals':
        return actualValue === expectedValue;
      case 'not_equals':
        return actualValue !== expectedValue;
      case 'contains':
        return Array.isArray(actualValue) 
          ? actualValue.includes(expectedValue)
          : String(actualValue).includes(String(expectedValue));
      case 'greater_than':
        return Number(actualValue) > Number(expectedValue);
      case 'less_than':
        return Number(actualValue) < Number(expectedValue);
      default:
        return true;
    }
  }

  // Get visible fields based on current form data
  getVisibleFields(formData: Record<string, any>): FormFieldConfig[] {
    return this.getAllFields().filter(field => this.shouldShowField(field, formData));
  }

  // Validate specific field
  async validateField(fieldName: string, value: any): Promise<string | null> {
    if (!this.schema) return null;

    try {
      const fieldSchema = this.schema.shape[fieldName];
      if (fieldSchema) {
        await fieldSchema.parseAsync(value);
        return null;
      }
    } catch (error) {
      if (error instanceof ZodError) {
        return error.errors[0]?.message || 'Invalid value';
      }
    }

    return null;
  }

  // Get field by name
  getField(name: string): FormFieldConfig | null {
    return this.getAllFields().find(field => field.name === name) || null;
  }

  // Update field configuration
  updateField(name: string, updates: Partial<FormFieldConfig>): void {
    const allFields = this.getAllFields();
    const fieldIndex = allFields.findIndex(field => field.name === name);
    
    if (fieldIndex !== -1) {
      Object.assign(allFields[fieldIndex], updates);
      this.generateSchema(); // Regenerate schema with updates
    }
  }

  // Add new field
  addField(field: FormFieldConfig, sectionIndex?: number): void {
    if (sectionIndex !== undefined && this.config.sections?.[sectionIndex]) {
      this.config.sections[sectionIndex].fields.push(field);
    } else {
      if (!this.config.fields) {
        this.config.fields = [];
      }
      this.config.fields.push(field);
    }
    
    this.generateSchema();
  }

  // Remove field
  removeField(name: string): void {
    if (this.config.fields) {
      this.config.fields = this.config.fields.filter(field => field.name !== name);
    }
    
    if (this.config.sections) {
      this.config.sections.forEach(section => {
        section.fields = section.fields.filter(field => field.name !== name);
      });
    }
    
    this.generateSchema();
  }

  // Export configuration as JSON
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  // Import configuration from JSON
  static fromJSON(json: string): FormBuilder {
    try {
      const config = JSON.parse(json) as FormConfig;
      return new FormBuilder(config);
    } catch (error) {
      throw new Error('Invalid form configuration JSON');
    }
  }

  // Create a simple form with basic fields
  static createSimple(fields: Omit<FormFieldConfig, 'name'>[] & { name: string }[]): FormBuilder {
    return new FormBuilder({
      fields: fields as FormFieldConfig[],
      showReset: true,
      showProgress: false,
      autoSave: false,
    });
  }

  // Create a wizard form
  static createWizard(sections: FormSectionConfig[]): FormBuilder {
    return new FormBuilder({
      sections,
      showProgress: true,
      autoSave: true,
      validation: {
        validateOnChange: true,
        validateOnBlur: true,
        debounceMs: 500,
      },
    });
  }
}

// Predefined form templates
export const FormTemplates = {
  // Contact form template
  contact: new FormBuilder({
    title: 'Contact Us',
    description: 'Get in touch with our team',
    fields: [
      {
        name: 'name',
        type: 'text',
        label: 'Full Name',
        required: true,
        minLength: 2,
        maxLength: 50,
      },
      {
        name: 'email',
        type: 'email',
        label: 'Email Address',
        required: true,
      },
      {
        name: 'subject',
        type: 'text',
        label: 'Subject',
        required: true,
        minLength: 5,
        maxLength: 100,
      },
      {
        name: 'message',
        type: 'textarea',
        label: 'Message',
        required: true,
        minLength: 10,
        maxLength: 1000,
      },
    ],
    submitLabel: 'Send Message',
    showReset: true,
    autoSave: true,
  }),

  // User profile template
  profile: new FormBuilder({
    title: 'Profile Settings',
    description: 'Update your personal information',
    sections: [
      {
        title: 'Basic Information',
        fields: [
          {
            name: 'name',
            type: 'text',
            label: 'Full Name',
            required: true,
            minLength: 2,
            maxLength: 50,
          },
          {
            name: 'email',
            type: 'email',
            label: 'Email Address',
            required: true,
          },
          {
            name: 'phone',
            type: 'tel',
            label: 'Phone Number',
          },
        ],
      },
      {
        title: 'Additional Information',
        collapsible: true,
        fields: [
          {
            name: 'bio',
            type: 'textarea',
            label: 'Bio',
            maxLength: 500,
          },
          {
            name: 'website',
            type: 'url',
            label: 'Website',
          },
          {
            name: 'location',
            type: 'text',
            label: 'Location',
            maxLength: 100,
          },
        ],
      },
    ],
    submitLabel: 'Save Changes',
    showReset: true,
    showProgress: true,
    autoSave: true,
  }),
};

export default FormBuilder;