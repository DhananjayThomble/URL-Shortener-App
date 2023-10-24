import React from 'react';
import SingleOutput from './SingleOutput';

const LinkList = ({ responseList }) => {
  return (
    <div>
      {responseList &&
        responseList.map((item) => {
          const { shortUrl } = item;

          return <SingleOutput key={shortUrl} {...item} />;
        })}
    </div>
  );
};

export default LinkList;
