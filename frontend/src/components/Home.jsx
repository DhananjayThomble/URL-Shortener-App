import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Form, Button } from 'react-bootstrap';
import { toast } from 'react-toastify';
import axios from 'axios';
import { FaLink } from 'react-icons/fa';

function Home() {
  const [originalUrl, setOriginalUrl] = useState('');
  const [shortUrl, setShortUrl] = useState('');
  const [name, setName] = useState(localStorage.getItem('name') || 'Guest');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const URL = `${import.meta.env.VITE_API_ENDPOINT}/api/url`;

  useEffect(() => {
    const token = localStorage.getItem('token');
    setName(localStorage.getItem('name') || 'Guest');
    if (!token) {
      setIsAuthenticated(false);
      toast.warning('Please Login to use the App');
    } else {
      setIsAuthenticated(true);
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return false;
    // show toast
    if (isAuthenticated) toast('URL will be shortened soon!');

    await fetchUrl();
  };

  function validateForm() {
    if (originalUrl === '') {
      toast.error('All fields are required');
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
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        },
      );
      const { shortUrl } = response.data;
      setShortUrl(shortUrl);
      toast.success('URL shortened successfully!');
    } catch (error) {
      if (error.response) {
        const { status, data } = error.response;
        if (status === 400) {
          toast.error(data.error);
        } else if (status === 401) {
          toast.error('Heyy, you have to login first!');
        } else if (status === 500) {
          toast.error(data.error);
        } else {
          toast.error('Something went wrong');
        }
      } else {
        toast.error('Network error. Please try again.');
      }
    }
  };
  return (
    <>
      <div className={'mt-4 p-4 bg-primary text-white rounded jumbotron'}>
        <Container>
          <h1>Welcome {name} </h1>
          <p>
            A simple and easy to use tool to shorten your long links and make
            them easy to share.
          </p>
        </Container>
      </div>
      <Container>
        <Row>
          <Col md={{ span: 5, offset: 3 }}>
            <Form style={{ marginTop: '2rem' }} onSubmit={handleSubmit}>
              <Form.Group>
                <Form.Label>Enter URL</Form.Label>

                <Form.Control
                  id={'urlInput'}
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
                className={'w-100'}
                style={{ marginTop: '2rem' }}
                variant="outline-success"
                type="submit"
              >
                <FaLink /> Shorten
              </Button>
            </Form>
          </Col>
        </Row>
      </Container>
    </>
  );
}

export default Home;
