import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Container from "react-bootstrap/Container";
import React, { useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import axios from "axios";

function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const URL = "https://app.dhananjaythomble.me/api/v2/";

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    toast.info("Signing up...");
    await fetchSignup();
  };

  function checkPassword() {
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return false;
    } else if (password.length < 6) {
      toast.error("Password must be at least 6 characters long");
      return false;
    }
    return true;
  }

  function validateForm() {
    if (
      email === "" ||
      password === "" ||
      confirmPassword === "" ||
      name === ""
    ) {
      toast.error("All fields are required");
      return false;
    }

    if (!checkPassword()) {
      return false;
    }
    return true;
  }

  const fetchSignup = async () => {
    try {
      const response = await axios.post(`${URL}auth/signup`, {
        email,
        password,
        name,
      });
      console.log(response);
      if (response.data.ok) {
        toast.success("Signup successful");
        window.location = "/login";
      }
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
            <h4>Sign Up</h4>
          </Card.Header>
          <Card.Body>
            <Form onSubmit={handleSubmit}>
              <Form.Group className={"md-3"} controlId={"formName"}>
                <Form.Label>Name</Form.Label>
                <Form.Control
                  type={"text"}
                  placeholder={"Enter Your Name"}
                  onChange={(e) => setName(e.target.value)}
                />
              </Form.Group>
              <Form.Group className="mb-3" controlId="formBasicEmail">
                <Form.Label>Email address</Form.Label>
                <Form.Control
                  type="email"
                  placeholder="Enter email"
                  onChange={(e) => setEmail(e.target.value)}
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
                />
              </Form.Group>
              <Form.Group className="mb-3" controlId="formBasicPasswordConfirm">
                <Form.Label>Confirm Password</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Confirm Password"
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Form.Group>

              <Button className={"w-100"} variant="info" type="submit">
                Sign Up
              </Button>
            </Form>
          </Card.Body>
          <Card.Footer className="text-muted">
            Already Have an Account?{" "}
            <a href={"/login"} style={{ textDecoration: "none" }}>
              Click Here to Login
            </a>
          </Card.Footer>
        </Card>
      </div>
    </Container>
  );
}

export default Signup;
