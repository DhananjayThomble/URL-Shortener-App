import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Container from "react-bootstrap/Container";
import React, { useState, useEffect } from "react";
import { toast, ToastContainer } from "react-toastify";
import axios from "axios";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const URL = "https://app.dhananjaythomble.me/api/v2/";

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      window.location = "/";
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return false;

    await fetchLogin();
  };

  function validateForm() {
    if (email === "" || password === "") {
      toast.error("All fields are required");
      return false;
    }
    return true;
  }

  const fetchLogin = async () => {
    try {
      const response = await axios.post(`${URL}auth/login`, {
        email,
        password,
      });
      const { token } = response.data;
      //    set token in local storage
      localStorage.setItem("token", token);
      window.location = "/";
    } catch ({
      response: {
        status,
        data: { error },
      },
    }) {
      if (status === 400) {
        toast.error(error);
      } else if (status === 401) {
        toast.error(error);
      } else {
        toast.error("Something went wrong");
      }
    }
  };

  return (
    <Container
      className="d-flex align-items-center justify-content-center"
      style={{ minHeight: "90vh" }}
    >
      <ToastContainer
        position="top-center"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
      <div className="w-100" style={{ maxWidth: "400px" }}>
        <Card>
          <Card.Header>
            {" "}
            <h4>Login</h4>{" "}
          </Card.Header>
          <Card.Body>
            <Form onSubmit={handleSubmit}>
              <Form.Group className="mb-3" controlId="formBasicEmail">
                <Form.Label>Email address</Form.Label>
                <Form.Control
                  type="email"
                  placeholder="Enter email"
                  onChange={(e) => setEmail(e.target.value)}
                  aria-required={true}
                />
                <Form.Text className="text-muted">
                  We'll never share your email with anyone else.
                </Form.Text>
              </Form.Group>
              <Form.Group className="mb-3" controlId="formBasicPassword">
                <Form.Label>Password</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Password"
                  onChange={(e) => setPassword(e.target.value)}
                  aria-required={true}
                />
              </Form.Group>
              <Button className={"w-100"} variant="info" type="submit">
                Login
              </Button>
            </Form>
          </Card.Body>
          <Card.Footer className="text-muted">
            Don't Have an Account?{" "}
            <a href={"/signup"} style={{ textDecoration: "none" }}>
              Click Here to Signup
            </a>
          </Card.Footer>
        </Card>
      </div>
    </Container>
  );
}

export default Login;
