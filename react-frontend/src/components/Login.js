import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Container from "react-bootstrap/Container";

function Login() {
  return (
    <Container
      className="d-flex align-items-center justify-content-center"
      style={{ minHeight: "90vh" }}
    >
      <div className="w-100" style={{ maxWidth: "400px" }}>
        <Card>
          <Card.Header>
            {" "}
            <h4>Login</h4>{" "}
          </Card.Header>
          <Card.Body>
            <Form>
              <Form.Group className="mb-3" controlId="formBasicEmail">
                <Form.Label>Email address</Form.Label>
                <Form.Control type="email" placeholder="Enter email" />
                <Form.Text className="text-muted">
                  We'll never share your email with anyone else.
                </Form.Text>
              </Form.Group>
              <Form.Group className="mb-3" controlId="formBasicPassword">
                <Form.Label>Password</Form.Label>
                <Form.Control type="password" placeholder="Password" />
              </Form.Group>
            </Form>

            <Button className={"w-100"} variant="info" type="submit">
              Login
            </Button>
          </Card.Body>
          <Card.Footer className="text-muted">
            Don't Have an Account?{" "}
            <a href={"/signup"} style={{ textDecoration: "none" }}>
              Click Here to Signup
            </a>{" "}
          </Card.Footer>
        </Card>
      </div>
    </Container>
  );
}

export default Login;
