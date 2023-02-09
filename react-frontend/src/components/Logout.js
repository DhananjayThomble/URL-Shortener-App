import React, { useEffect, useContext } from "react";
import { toast, ToastContainer } from "react-toastify";
import UserContext from "../context/UserContext";

function Logout(props) {
  //  delete the token from local storage
  useEffect(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("name");
  }, []);

  const context = useContext(UserContext);
  context.setUser(null);
  toast.success("You are logged out");

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
