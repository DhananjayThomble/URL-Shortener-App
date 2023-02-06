import React from "react";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import HistoryCard from "./HistoryCard";
import { useState, useEffect } from "react";
import axios from "axios";
import { toast, ToastContainer } from "react-toastify";

function History() {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (localStorage.getItem("token") === null) {
      toast.warning("Please Login First");
    } else {
      fetchData();
    }
  }, []);

  const fetchData = async () => {
    try {
      const result = await axios.get(
        "https://app.dhananjaythomble.me/api/v2/history",
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      setHistory(result.data.urlArray);
      // console.log(history);
      if (result.data.urlArray.length === 0) {
        toast.info("No History Found");
      }
    } catch (error) {
      if (error.response.status === 401) {
        toast.error("Please Login First");
      }
    }
  };

  return (
    <Container className={"pt-4"}>
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
      {history.map((data) => {
        return (
          <Row className={"my-1"}>
            <Col>
              <HistoryCard
                shortUrl={data.shortUrl}
                originalUrl={data.originalUrl}
                visitCount={data.visitCount || 0}
              />
            </Col>
          </Row>
        );
      })}
    </Container>
  );
}

export default History;
