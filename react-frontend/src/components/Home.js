import React, { useState } from "react";
import { Container, Row, Col, Form, Button } from "react-bootstrap";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.min.css";

function Home() {
  const [url, setUrl] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    // show toast
    toast("URL will be shortened soon!");
    console.log("url value is ", url);

    fetch("https://app.dhananjaythomble.me/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: url }),
    })
      .then((response) => response.json())
      .then((data) => {
        // if (data.status === 200) {
        //   setUrl("");
        //   console.log(data);
        // } else {
        //   alert(data.message);
        //   console.log(data);
        // }
        if (data) {
          setUrl(data.short_url);
          console.log(data.short_url);
        }
      })
      .catch((error) => {
        alert(error);
      });
  };

  return (
    <>
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
      <div className={"mt-4 p-4 bg-primary text-white rounded jumbotron"}>
        <Container>
          <h1>Welcome to URL Shortener</h1>
          <p>
            A simple and easy to use tool to shorten your long links and make
            them easy to share.
          </p>
        </Container>
      </div>
      <Container>
        <Row>
          <Col md={{ span: 5, offset: 3 }}>
            <Form style={{ marginTop: "2rem" }} onSubmit={handleSubmit}>
              <Form.Group>
                <Form.Label>Enter URL</Form.Label>

                <Form.Control
                  type="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Form.Group>
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
