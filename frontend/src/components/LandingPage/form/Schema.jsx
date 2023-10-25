import * as Yup from 'yup';

// STUB: define form validation
const LinkSchema = Yup.object().shape({
  link: Yup.string().required('Please add a link'),
});

export { LinkSchema };
