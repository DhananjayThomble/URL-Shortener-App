import React, { useState } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import LinkForm from './LinkForm';
import LinkList from './LinkList';

const LinkParent = () => {
  const [responseList, setResponseList] = useState([]);
  const [snackbar, setSnackbar] = useState(null);
  // const [shortUrls, setShortUrls] = useState([]);

  React.useEffect(() => {
    // console.log("responseList from parent *", responseList);
  }, [responseList]);

  const handleCloseSnackbar = () => setSnackbar(null);

  // STUB: grab formValue from LinkForm onSubmit
  const handleFormValue = (param) => {
    // console.log("formValue from parent", param);
    // setResponseList([...responseList, param]);
    setResponseList((prev) => [...prev, param]);
    // console.log("responseList from parent", responseList);
  };

  // STUB: grab snackbarSuccess msg from LinkForm onSubmit
  const handleSnackbarSuccess = (param) => {
    setSnackbar(param);
  };

  return (
    <div>
      <LinkForm
        onFormValueChange={handleFormValue}
        onSnackbarSuccess={handleSnackbarSuccess}
      />
      <LinkList responseList={responseList} />

      {!!snackbar && (
        <Snackbar
          open
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          onClose={handleCloseSnackbar}
          autoHideDuration={10000}
        >
          <Alert {...snackbar} onClose={handleCloseSnackbar} />
        </Snackbar>
      )}
    </div>
  );
};

export default LinkParent;
