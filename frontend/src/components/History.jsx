import React, { useRef } from 'react';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import ExportToExcel from './ExportToExcel';
import { Button, Dropdown, Form } from 'react-bootstrap';
import Pagination from './Pagination';

function History() {
  const [history, setHistory] = useState([]);
  const [categoryArray, setCategoryArray] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState(null);
  const [addCategory, setAddCategory] = useState();
  let toastId = useRef(null);

  const historyCategory = (history) => {
    const categories = history.reduce((acc, curr) => {
      if (!acc.includes(curr.category)) {
        acc.push(curr.category);
      }
      return acc;
    }, []);
    setCategoryArray(categories);
  };

  // let toastId = useRef(null);

  useEffect(() => {
    // console.log(`history api is called`);
    // console.log(import.meta.env.VITE_API_ENDPOINT);
    const fetchData = async () => {
      try {
        toastId.current = toast.loading('Fetching History...');
        const result = await axios.get(
          `${import.meta.env.VITE_API_ENDPOINT}/api/history`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
          },
        );
        setHistory(result.data.urlArray);
        historyCategory(result.data.urlArray);
        // console.log(history);
        // console.log(`history api is called`);
        if (result.data.urlArray.length === 0) {
          toast.update(toastId.current, {
            render: 'No History Found',
            type: 'info',
            isLoading: false,
            autoClose: 2000,
          });
        }

        toast.update(toastId.current, {
          render: 'History Fetched',
          type: 'success',
          isLoading: false,
          autoClose: 2000,
        });
      } catch (error) {
        if (error.response.status === 401) {
          toast.update(toastId.current, {
            render: 'Please Login First',
            type: 'error',
            isLoading: false,
            autoClose: 2000,
          });
        }

        toast.update(toastId.current, {
          render: 'Something went wrong',
          type: 'error',
          isLoading: false,
          autoClose: 2000,
        });
      }
    };
    if (localStorage.getItem('token') === null) {
      toast.warning('Please Login First');
    } else {
      fetchData();
    }
  }, []);

  useEffect(() => {
    selectedFilter &&
      (async () => {
        try {
          toastId.current = toast.loading('Fetching History...');
          const result = await axios.get(
            `${
              import.meta.env.VITE_API_ENDPOINT
            }/api/url/filter/${selectedFilter}`,
            {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
              },
            },
          );
          setHistory(result.data.urlArray);
          // console.log(`length of history array is ${result.data.urlArray.length}`);
          if (result.data.urlArray.length === 0) {
            toast.update(toastId.current, {
              render: 'No History Found',
              type: 'info',
              isLoading: false,
              autoClose: 2000,
            });
          }
          toast.update(toastId.current, {
            render: 'History Fetched',
            type: 'success',
            isLoading: false,
            autoClose: 2000,
          });
        } catch (error) {
          if (error.response.status === 401) {
            toast.update(toastId.current, {
              render: 'Please Login First',
              type: 'error',
              isLoading: false,
              autoClose: 2000,
            });
          }

          toast.update(toastId.current, {
            render: 'Something went wrong',
            type: 'error',
            isLoading: false,
            autoClose: 2000,
          });
        }
      })();
  }, [selectedFilter]);

  return (
    <Container className={'pb-5'}>
      <h3 className="my-3">URLs</h3>
      <div className="d-md-flex justify-content-between sm:block text-sm">
        <Dropdown>
          <Dropdown.Toggle id="dropdown-basic" className="my-2">
            {selectedFilter || 'Select Category'}
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {categoryArray.map((item, index) => {
              return (
                <Dropdown.Item
                  key={index}
                  onClick={(e) => setSelectedFilter(e.target.text)}
                >
                  {item}
                </Dropdown.Item>
              );
            })}
          </Dropdown.Menu>
        </Dropdown>
        <Form>
          <div className="d-flex my-2">
            <Form.Control
              type="text"
              aria-describedby="Add New Category"
              placeholder="Add New Category"
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value)}
            />
            <Button
              type="submit"
              className="mx-2"
              onClick={(e) => {
                e.preventDefault();
                setCategoryArray((prev) => [...prev, addCategory]);
                setAddCategory('');
              }}
            >
              Add
            </Button>
          </div>
        </Form>
        <Row className="my-2">
          <ExportToExcel />
        </Row>
      </div>
      <Pagination
        history={history}
        cardsPerPage={3}
        categoryArray={categoryArray}
      />
    </Container>
  );
}

export default History;
