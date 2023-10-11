import React from "react";
import SingleOutput from "./SingleOutput";

const LinkList = ({ responseList }) => {
  return (
    <div>
      {responseList &&
        responseList.map((item) => {
          const { code } = item;

          return <SingleOutput key={code} {...item} />;
        })}
    </div>
  );
};

export default LinkList;
