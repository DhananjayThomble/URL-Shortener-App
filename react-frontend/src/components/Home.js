import React, { useState, useEffect } from "react";
import { Container, Row, Col, Form, Button } from "react-bootstrap";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.min.css";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function Home() {
  const [originalUrl, setOriginalUrl] = useState("");
  const [shortUrl, setShortUrl] = useState("");
  const URL = "https://app.dhananjaythomble.me/api/v2/url";
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      //  disable #urlInput
      document.getElementById("urlInput").disabled = true;

      toast.warning("You are not logged in");
      setTimeout(() => {
        //  redirect to login page
        navigate("/login");
      }, 4000);
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return false;
    // show toast
    toast("URL will be shortened soon!");

    await fetchUrl();
  };

  function validateForm() {
    if (originalUrl === "") {
      toast.error("All fields are required");
      return false;
    }
    return true;
  }

  const fetchUrl = async () => {
    try {
      const response = await axios.post(
        URL,
        {
          url: originalUrl,
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }
      );
      const { shortUrl } = response.data;
      setShortUrl(shortUrl);
      toast.success("URL shortened successfully!");
    } catch ({
      // handle error here
      response: {
        status,
        data: { error },
      },
    }) {
      if (status === 400) {
        toast.error(error);
      } else if (status === 401) {
        toast.error(error);
      } else if (status === 500) {
        toast.error(error);
      } else {
        toast.error("Something went wrong");
      }
    }
  };

  return (
    <>
      <div className={"mt-4 p-4 bg-primary text-white rounded jumbotron"}>
        <Container>
          <h1>Welcome to URL Shortener</h1>
          <p>
            A simple and easy to use tool to shorten your long links and make
            them easy to share.
          </p>
        </Container>
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
      </div>
      <Container>
        <Row>
          <Col md={{ span: 5, offset: 3 }}>
            <Form style={{ marginTop: "2rem" }} onSubmit={handleSubmit}>
              <Form.Group>
                <Form.Label>Enter URL</Form.Label>

                <Form.Control
                  id={"urlInput"}
                  type="url"
                  placeholder="https://example.com"
                  value={originalUrl}
                  onChange={(e) => setOriginalUrl(e.target.value)}
                />
              </Form.Group>

              {shortUrl && (
                <Form.Group>
                  <Form.Label>Shortened URL</Form.Label>
                  <Form.Control value={shortUrl} readOnly />
                </Form.Group>
              )}

              {/*  make this button in center of the form input and make width 50%*/}
              <Button
                className={"w-100"}
                style={{ marginTop: "2rem" }}
                variant="outline-success"
                type="submit"
              >
                Shorten
              </Button>
            </Form>
          </Col>
        </Row>
      </Container>
    </>
  );
}

export default Home;
