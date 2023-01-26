import React from "react";

function Logout(props) {
  //  delete the token from local storage
  localStorage.removeItem("token");
  return <div>Logout</div>;
}

export default Logout;
