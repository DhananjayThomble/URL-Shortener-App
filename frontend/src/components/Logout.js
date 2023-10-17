import React, { useEffect, useContext } from "react";
import { toast } from "react-toastify";
import UserContext from "../context/UserContext";
import { useNavigate } from "react-router-dom";

function Logout() {
  const navigate = useNavigate();

  //  delete the token from local storage
  useEffect(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("name");
  }, []);

  const context = useContext(UserContext);
  context.setUser(null);
  // toast.success("You are logged out");
  navigate("/");
  return <div></div>;
}

export default Logout;
