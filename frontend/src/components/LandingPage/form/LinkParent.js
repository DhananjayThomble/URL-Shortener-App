// STUB: this component will hold the shared data between LinkForm and LinkList

import React, { useState, useEffect } from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import LinkForm from "./LinkForm";
import LinkList from "./LinkList";

const LinkParent = () => {

  const [formValue, setFormValue] = useState(null);
  const [responseList, setResponseList] = useState(); // set to saved responseList from localstorage, else set to empty array
  const [snackbar, setSnackbar] = useState(null);

  const handleCloseSnackbar = () => setSnackbar(null);

  // STUB: grab formValue from LinkForm onSubmit
  const handleFormValue = (param) => {
    setFormValue(param);
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
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
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
