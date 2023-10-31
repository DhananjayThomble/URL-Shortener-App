import * as Yup from 'yup';

// STUB: define form validation
const LinkSchema = Yup.object().shape({
  link: Yup.string()
    .required('Please add a link')
    .matches(/^https?:\/\/[^\s/$.?#].[^\s]*$/, 'Must be a valid URL!'),
});

const backHalfSchema = Yup.object().shape({
  customBackHalf: Yup.string()
    .required('Please add a link')
    .min(3, 'Length should be 3-10 characters')
    .max(10, 'Length should be 3-10 characters'),
});

export { LinkSchema, backHalfSchema };
