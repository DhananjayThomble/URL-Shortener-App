import Container from "react-bootstrap/Container";
import Nav from "react-bootstrap/Nav";
import Navbar from "react-bootstrap/Navbar";
import { LinkContainer } from "react-router-bootstrap";
import {
  FaHistory,
  FaHome,
  FaInfoCircle,
  FaSignOutAlt,
  FaSignInAlt,
  FaUserPlus,
} from "react-icons/fa";

function MyNavbar() {
  return (
    // dark navbar with react-bootstrap and react-router-bootstrap
    <Navbar bg="dark" variant="dark" expand="lg" collapseOnSelect={true}>
      <Container>
        <LinkContainer to="/">
          <Navbar.Brand>URL Shortener</Navbar.Brand>
        </LinkContainer>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            <LinkContainer to="/">
              <Nav.Link>
                <FaHome /> Home
              </Nav.Link>
            </LinkContainer>

            <LinkContainer to="/about">
              <Nav.Link>
                <FaInfoCircle /> About
              </Nav.Link>
            </LinkContainer>

            <LinkContainer to="/login">
              <Nav.Link>
                <FaSignInAlt /> Login
              </Nav.Link>
            </LinkContainer>

            <LinkContainer to="/signup">
              <Nav.Link>
                <FaUserPlus /> Sign Up
              </Nav.Link>
            </LinkContainer>

            <LinkContainer to="/logout">
              <Nav.Link>
                <FaSignOutAlt /> Logout
              </Nav.Link>
            </LinkContainer>

            <LinkContainer to={"/history"}>
              <Nav.Link>
                <FaHistory /> History
              </Nav.Link>
            </LinkContainer>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}

export default MyNavbar;
