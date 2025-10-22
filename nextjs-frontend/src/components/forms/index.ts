// Core form components
export { Form } from './Form';
export type { FormProps } from './Form';

export {
  FormField,
  FormInput,
  FormSelect,
  FormCheckbox,
  FormRadioGroup,
  FormSubmitButton,
  FormResetButton,
} from './FormField';
export type {
  FormInputProps,
  FormSelectProps,
  FormCheckboxProps,
  FormRadioGroupProps,
  FormSubmitButtonProps,
  FormResetButtonProps,
} from './FormField';

// Advanced form components
export { default as FormLayout } from './FormLayout';
export type { FormLayoutProps, FormSection } from './FormLayout';

export { default as FormArray } from './FormArray';
export type { FormArrayProps, FormArrayItem } from './FormArray';

export { default as FileUpload } from './FileUpload';
export type { FileUploadProps } from './FileUpload';

export { default as DateTimePicker } from './DateTimePicker';
export type { DateTimePickerProps } from './DateTimePicker';

export { default as FormWizard } from './FormWizard';
export type { FormWizardProps } from './FormWizard';

// Form templates
export { LoginForm } from './templates/LoginForm';
export type { LoginFormProps } from './templates/LoginForm';

export { RegisterForm } from './templates/RegisterForm';
export type { RegisterFormProps } from './templates/RegisterForm';

// Form utilities and hooks
export {
  useAutoSave,
  useFormRecovery,
  FormStorage,
  FormSessionManager,
  AutoSavePresets,
} from '../../lib/forms/autoSave';
export type { AutoSaveConfig } from '../../lib/forms/autoSave';

export { useAdvancedForm } from '../../hooks/useAdvancedForm';
export type {
  FormField as AdvancedFormField,
  FormState,
  FormActions,
  UseAdvancedFormOptions,
} from '../../hooks/useAdvancedForm';

// Validation schemas and utilities
export {
  ValidationSchemas,
  AuthSchemas,
  UserSchemas,
  UrlSchemas,
  ContactSchemas,
  AdminSchemas,
  BaseSchemas,
  ValidationPatterns,
  ValidationMessages,
} from '../../lib/validation/schemas';

// Advanced validation rules
export {
  ValidationPatterns as AdvancedValidationPatterns,
  ValidationRules,
  ValidationUtils,
} from '../../lib/validation/rules';
export type {
  ValidationRule,
  ValidationPattern,
} from '../../lib/validation/rules';
export type {
  LoginFormData,
  RegisterFormData,
  ForgotPasswordFormData,
  ResetPasswordFormData,
  ChangePasswordFormData,
  ProfileFormData,
  PreferencesFormData,
  CreateUrlFormData,
  UpdateUrlFormData,
  ContactFormData,
  FeedbackFormData,
} from '../../lib/validation/schemas';