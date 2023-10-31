import React from 'react';
import SingleOutput from './SingleOutput';

const LinkList = ({ responseList, onSnackbarSuccess, onFormValueChange }) => {
  return (
    <div>
      {responseList &&
        responseList.map((item) => {
          const { shortUrl } = item;

          return <SingleOutput
            key={shortUrl}
            {...item}
            onSnackbarSuccess={onSnackbarSuccess}
            onFormValueChange={onFormValueChange}
          />;
        })}
    </div>
  );
};

export default LinkList;
