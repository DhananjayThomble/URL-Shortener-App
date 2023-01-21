import React, { useState } from "react";
import { Container, Row, Col, Form, Button } from "react-bootstrap";

function Home() {
  const [url, setUrl] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log("url value is ", url);
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
