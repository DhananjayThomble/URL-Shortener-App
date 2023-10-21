import React from "react";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import HistoryCard from "./HistoryCard";
import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import ExportToExcel from "./ExportToExcel";
import { Button, Dropdown, Form } from "react-bootstrap";

function History() {
  const [history, setHistory] = useState([]);
  const [categoryArray, setCategoryArray] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState(null);
  const [addCategory, setAddCategory] = useState();
  let toastId = null;

  const historyCategory = (history) => {
    const categories = history.reduce((acc, curr) => {
      if (!acc.includes(curr.category)) {
        acc.push(curr.category);
      }
      return acc;
    }, []);
    setCategoryArray(categories);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        toastId = null;
        toastId = toast.loading("Fetching History...");
        const result = await axios.get(
          `${process.env.REACT_APP_API_ENDPOINT}/api/history`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );
        setHistory(result.data.urlArray);
        historyCategory(result.data.urlArray);
        // console.log(history);
        console.log(`history api is called`);
        if (result.data.urlArray.length === 0) {
          toast.update(toastId, {
            render: "No History Found",
            type: "info",
            isLoading: false,
            autoClose: 2000,
          });
        }

        toast.update(toastId, {
          render: "History Fetched",
          type: "success",
          isLoading: false,
          autoClose: 2000,
        });
      } catch (error) {
        if (error.response.status === 401) {
          toast.update(toastId, {
            render: "Please Login First",
            type: "error",
            isLoading: false,
            autoClose: 2000,
          });
        }

        toast.update(toastId, {
          render: "Something went wrong",
          type: "error",
          isLoading: false,
          autoClose: 2000,
        });
      }
    };
    if (localStorage.getItem("token") === null) {
      toast.warning("Please Login First");
    } else {
      fetchData();
    }
  }, []);

  useEffect(() => {
    selectedFilter &&
      (async () => {
        try {
          toastId = null;
          toastId = toast.loading("Fetching History...");
          const result = await axios.get(
            `${process.env.REACT_APP_API_ENDPOINT}/api/url/filter/${selectedFilter}`,
            {
              headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
            }
          );
          setHistory(result.data.urlArray);
          if (result.data.urlArray.length === 0) {
            toast.update(toastId, {
              render: "No History Found",
              type: "info",
              isLoading: false,
              autoClose: 2000,
            });
          }
          toast.update(toastId, {
            render: "History Fetched",
            type: "success",
            isLoading: false,
            autoClose: 2000,
          });
        } catch (error) {
          if (error.response.status === 401) {
            toast.update(toastId, {
              render: "Please Login First",
              type: "error",
              isLoading: false,
              autoClose: 2000,
            });
          }

          toast.update(toastId, {
            render: "Something went wrong",
            type: "error",
            isLoading: false,
            autoClose: 2000,
          });
        }
      })();
  }, [selectedFilter]);

  return (
    <Container className={"pb-5"}>
      <div className="my-3  container d-flex align-items-center justify-content-around">
        <Dropdown>
          <Dropdown.Toggle
            variant="success"
            id="dropdown-basic"
            className="mt-2"
          >
            {selectedFilter || "Select Category"}
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
          <div className="d-flex">
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
                setAddCategory("");
              }}
            >
              Add
            </Button>
          </div>
        </Form>
      </div>

      <Row className={"my-1"}>
        {history.map((data) => {
          return (
            <Col md={6} className={"p-1"} key={data._id}>
              <HistoryCard
                key={data._id}
                shortUrl={data.shortUrl}
                originalUrl={data.originalUrl}
                visitCount={data.visitCount || 0}
                category={data.category}
                categoryArray={categoryArray}
              />
            </Col>
          );
        })}
      </Row>
      <Row>
        <ExportToExcel />
      </Row>
    </Container>
  );
}

export default History;
