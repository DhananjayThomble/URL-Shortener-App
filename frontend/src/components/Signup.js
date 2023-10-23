import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Container from "react-bootstrap/Container";
import React, { useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import {
  FaUserAlt,
  FaKey,
  FaUserCircle,
  FaRegPaperPlane,
} from "react-icons/fa";

function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const URL = `${process.env.REACT_APP_API_ENDPOINT}`;
  const navigate = useNavigate();
  let toastId = null;

  const handleSubmit = async (e) => {
    e.preventDefault();

    toastId = null;
    toastId = toast.loading("Signing up...");
    if (!validateForm()) return;
    await fetchSignup();
  };

  function checkPassword() {
    if (password !== confirmPassword) {
      toast.update(toastId, {
        render: "Passwords do not match",
        type: "error",
        isLoading: false,
        autoClose: 2000,
      });
      return false;
    } else if (password.length < 6) {
      toast.update(toastId, {
        render: "Password must be at least 6 characters",
        type: "error",
        isLoading: false,
        autoClose: 2000,
      });
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
      toast.update(toastId, {
        render: "Please fill all the fields",
        type: "error",
        isLoading: false,
        autoClose: 2000,
      });
      return false;
    }

    if (!checkPassword()) {
      return false;
    }
    return true;
  }

  const fetchSignup = async () => {
    try {
      // console.log(URL);
      const response = await axios.post(`${URL}/auth/signup`, {
        email,
        password,
        name,
      });
      // console.log(response);
      if (response.data.ok) {
        toast.update(toastId, {
          render: "Signup successful",
          type: "success",
          isLoading: false,
          autoClose: 2000,
        });
        navigate("/login");
      } else {
        toast.update(toastId, {
          render: "Signup failed",
          type: "error",
          isLoading: false,
          autoClose: 2000,
        });
      }
    } catch (error) {
      console.error("Error during signup:", error);
      toast.update(toastId, {
        render: "Signup failed",
        type: "error",
        isLoading: false,
        autoClose: 2000,
      });
    }
  };

  return (
    <Container
      className="d-flex align-items-center justify-content-center"
      style={{ minHeight: "90vh" }}
    >
      <div className="w-100" style={{ maxWidth: "400px" }}>
        <Card>
          <Card.Header style={{ backgroundColor: "#4B3F6B" }}>
            <h4 style={{ backgroundColor: "#4B3F6B" }}>Sign Up</h4>
          </Card.Header>
          <Card.Body>
            <Form onSubmit={handleSubmit}>
              <Form.Group className={"md-3"} controlId={"formName"}>
                <Form.Label>
                  <FaUserCircle /> Name
                </Form.Label>
                <Form.Control
                  type={"text"}
                  placeholder={"Enter Your Name"}
                  onChange={(e) => setName(e.target.value)}
                />
              </Form.Group>
              <Form.Group className="mb-3" controlId="formBasicEmail">
                <Form.Label>
                  <FaUserAlt /> Email address
                </Form.Label>
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
                <Form.Label>
                  <FaKey /> Password
                </Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Form.Group>
              <Form.Group className="mb-3" controlId="formBasicPasswordConfirm">
                <Form.Label>
                  <FaKey /> Confirm Password
                </Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Confirm Password"
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Form.Group>

              <Button
                variant="info"
                type="submit"
                style={{ backgroundColor: "#4B3F6B" }}
              >
                <FaRegPaperPlane /> Sign Up
              </Button>
            </Form>
          </Card.Body>
          <Card.Footer className="text-muted">
            Already Have an Account?{" "}
            <a
              style={{
                textDecoration: "none",
                color: "#4B3F6B",
                cursor: "pointer",
              }}
              onClick={() => {
                navigate("/login");
              }}
            >
              Click Here to Login
            </a>
          </Card.Footer>
        </Card>
      </div>
    </Container>
  );
}

export default Signup;