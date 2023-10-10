import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom"; // Import useLocation hook

function ResetPassword() {
  const location = useLocation(); // Use the useLocation hook to access the URL

  const queryParams = new URLSearchParams(location.search); // Extract query parameters
  const token = queryParams.get("token"); 

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      
      setMessage("Invalid or missing token.");
    }
  }, [token]);

  const handleResetPassword = async () => {
    try {
      // Make a POST request to your backend API to reset the password
      const response = await fetch(`${process.env.REACT_APP_API_ENDPOINT}/auth/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, password }),
      });

      if (response.status === 200) {
        setMessage("Password reset successful.");
      } else {
        // Handle error response from the backend
        const data = await response.json();
        setMessage(data.error || "Password reset failed.");
      }
    } catch (error) {
      console.error("Error resetting password:", error);
      setMessage("Password reset failed.");
    }
  };

  return (
    <div>
      <h1>Reset Password</h1>
      <p>{message}</p>
      <input
        type="password"
        placeholder="New Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        type="password"
        placeholder="Confirm Password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      <button onClick={handleResetPassword}>Reset Password</button>
    </div>
  );
}

export default ResetPassword;
