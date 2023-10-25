import Accordion from 'react-bootstrap/Accordion';

import React from 'react';

function About() {
  return (
    <div className="d-flex justify-content-center">
      <div className="w-75 p-3" style={{ maxWidth: '200px;' }}>
        <h1>About SnapURL</h1>
        <p>
          SnapURL is an open-source URL shortener that makes converting long,
          cumbersome URLs into short, easy-to-share links simple. It provides
          user-friendly features as well as tracking capabilities to improve
          your web experience.
        </p>
        <h4>Why Use SnapURL?</h4>
        <p>
          SnapURL is an open-source URL shortener that allows you to create,
          track, and share short links for free. It is a self-hosted alternative
          to paid URL shorteners such as Bitly and TinyURL. SnapURL is simple to
          use and has a clean, modern interface. It's built with React, Node,
          Express, and MongoDB.
        </p>
        <h4>Features</h4>
        <p>
          SnapURL provides a variety of features to improve your web experience.
          These include:
        </p>
        <ol>
          <li>Custom URLs</li>
          <li>Link Password Protection</li>
          <li>Link Analytics</li>
          <li>QR Code Generation</li>
          <li>Link Deletion</li>
        </ol>
        <br />
        <h3>Frequently Asked Questions</h3>
        <br />
        <Accordion className="px-md-3">
          <Accordion.Item eventKey="0">
            <Accordion.Header>1. What is SnapURL?</Accordion.Header>
            <Accordion.Body>
              SnapURL is an open-source URL shortener that makes converting
              long, cumbersome URLs into short, easy-to-share links simple. It
              provides user-friendly features as well as tracking capabilities
              to improve your web experience.
            </Accordion.Body>
          </Accordion.Item>
          <Accordion.Item eventKey="1">
            <Accordion.Header>
              2. How do I get started with SnapURL?
            </Accordion.Header>
            <Accordion.Body>
              Simply create a SnapURL account to get started. After registering,
              you can begin shortening URLs and taking advantage of our
              services.
            </Accordion.Body>
          </Accordion.Item>
          <Accordion.Item eventKey="2">
            <Accordion.Header>3. Is SnapURL free to use?</Accordion.Header>
            <Accordion.Body>
              SnapURL is, indeed, completely free to use. We do not charge any
              fees for our services.
            </Accordion.Body>
          </Accordion.Item>
          <Accordion.Item eventKey="3">
            <Accordion.Header>
              4. Is my data secure with SnapURL?
            </Accordion.Header>
            <Accordion.Body>
              Yes, the security of your data is a top priority for us. For added
              security, we use strong password hashing with Bcrypt and provide
              email verification and password reset via email.
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>
      </div>
    </div>
  );
}

export default About;
