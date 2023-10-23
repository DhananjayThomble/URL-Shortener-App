import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Container from "react-bootstrap/Container";
import React, { useEffect, useState, useContext } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { FaUserAlt, FaKey, FaRegPaperPlane } from "react-icons/fa";
import UserContext from "../context/UserContext";
import "../App.css";
import "./Footer.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const URL = `${process.env.REACT_APP_API_ENDPOINT}`;
  const navigate = useNavigate();
  const context = useContext(UserContext);
  let toastId = null;

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      toast.warning("You are already logged in");
      setTimeout(() => {
        navigate("/");
      }, 4000);
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    toastId = null;
    toastId = toast.loading("Logging in...");
    if (!validateForm()) return;

    await fetchLogin();
  };

  function validateForm() {
    if (email === "" || password === "") {
      toast.update(toastId, {
        render: "Please fill all the fields",
        type: "error",
        isLoading: false,
        autoClose: 2000,
      });
      return false;
    }
    return true;
  }

  const fetchLogin = async () => {
    try {
      const response = await axios.post(`${URL}/auth/login`, {
        email,
        password,
      });
      const {
        token,
        user: { name },
      } = response.data;

      //    set token and logged-in user's name in local storage
      localStorage.setItem("token", token);
      localStorage.setItem("name", name);
      context.setUser({ token: token });
      toast.update(toastId, {
        render: `Welcome ${name}`,
        type: "success",
        isLoading: false,
        autoClose: 2000,
      });
      navigate("/");
    } catch ({
      response: {
        status,
        data: { error },
      },
    }) {
      toast.update(toastId, {
        render: "Login failed",
        type: "error",
        isLoading: false,
        autoClose: 2000,
      });
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
      <div className="w-100" style={{ maxWidth: "400px" }}>
        <Card>
          <Card.Header style={{ backgroundColor: "#4B3F6B" }}>
            {" "}
            <h4 style={{ backgroundColor: "#4B3F6B" }}>Login</h4>{" "}
          </Card.Header>
          <Card.Body>
            <Form onSubmit={handleSubmit}>
              <Form.Group className="mb-3" controlId="formBasicEmail">
                <Form.Label>
                  <FaUserAlt /> Email address
                </Form.Label>
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
                <Form.Label>
                  <FaKey /> Password
                </Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Password"
                  onChange={(e) => setPassword(e.target.value)}
                  aria-required={true}
                />
              </Form.Group>
              <Button
                className={"w-100"}
                variant="info"
                type="submit"
                style={{ backgroundColor: "#4B3F6B", color: "white" }}
              >
                <FaRegPaperPlane />
                Login
              </Button>
            </Form>
          </Card.Body>
          <Card.Footer className="text-muted" style={{}}>
            Don't Have an Account?{" "}
            <a href="/reset-password">
              {" "}
              <span style={{ marginLeft: "30px", color: "#4B3F6B" }}>
                Forgot password
              </span>{" "}
            </a>{" "}
            <br />
            <a
              href="/signup"
              style={{
                textDecoration: "none",
                color: "#4B3F6B",
                marginLeft: "100px",
              }}
            >
              <span>Click Here to Signup</span>
            </a>
          </Card.Footer>
        </Card>
      </div>
    </Container>
  );
}

export default Login;