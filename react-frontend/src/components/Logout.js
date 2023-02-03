import React, { useEffect } from "react";
import { toast, ToastContainer } from "react-toastify";

function Logout(props) {
  //  delete the token from local storage
  useEffect(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("name");
    toast.success("You are logged out");
  }, []);

  return (
    <>
      <ToastContainer
        position="top-center"
        autoClose={1000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
      <h1> See you Again! </h1>
    </>
  );
}

export default Logout;
