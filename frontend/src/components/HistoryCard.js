import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { FaRegChartBar, FaExternalLinkAlt, FaTrashAlt } from "react-icons/fa";
import { Dropdown, Form } from "react-bootstrap";

function HistoryCard({
  shortUrl,
  originalUrl,
  visitCount,
  category,
  categoryArray,
}) {
  const [urlId, setUrlId] = useState("");
  const [showCard, setShowCard] = useState(true);
  const [visitCountState, setVisitCountState] = useState(visitCount);
  const [categoryState, setCategoryState] = useState(category);

  useEffect(() => {
    setUrlId(shortUrl);
  }, [shortUrl]);

  const deleteUrl = async () => {
    try {
      const result = await axios.delete(
        `${process.env.REACT_APP_API_ENDPOINT}/api/delete/${urlId}`,
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      console.log(result);
      if (result.status === 200) {
        toast.success("URL Deleted Successfully");
        setShowCard(false);
      }
    } catch (error) {
      //
      console.log(error);
      toast.error(error.data.response.error);
    }
  };

  // extracting domain name from url
  const getDomainName = (url) => {
    const domainName = url.replace(/(^\w+:|^)\/\//, "").split("/")[0];
    return domainName;
  };

  const updateCategory = async (e) => {
    try {
      const result = await axios.put(
        `${process.env.REACT_APP_API_ENDPOINT}/api/url/filter/`,
        {
          shortUrl: shortUrl,
          category: e.target.innerText,
        },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      console.log(result);
      if (result.status === 200) {
        setCategoryState(e.target.innerText);
        toast.success("Category Updated Successfully");
      }
    } catch (error) {
      console.log(error);
      toast.error(error.data.response.error);
    }
  };

  if (showCard) {
    return (
      <Card border="secondary">
        <Card.Header as="h5">
          {getDomainName(originalUrl)}
          <div className={"float-end"}>
            <FaRegChartBar />
            <span style={{ color: "#EDC126" }}> {visitCountState}</span>
          </div>
        </Card.Header>
        <Card.Body>
          <Card.Title
            as={"h6"}
          >{`${process.env.REACT_APP_API_ENDPOINT}/api/url/${shortUrl}`}</Card.Title>
          <Card.Text>{originalUrl}</Card.Text>
          <div className="d-flex gap-2">
            <Dropdown>
              <Dropdown.Toggle variant="success" id="dropdown-basic">
                {categoryState || "Select Category"}
              </Dropdown.Toggle>
              <Dropdown.Menu>
                {categoryArray.map((item, index) => {
                  return (
                    <Dropdown.Item key={index} onClick={updateCategory}>
                      {item}
                    </Dropdown.Item>
                  );
                })}
              </Dropdown.Menu>
            </Dropdown>
            <Button
              variant="secondary"
              onClick={() => {
                //    open in new tab
                window.open(
                  `${process.env.REACT_APP_API_ENDPOINT}/api/url/${shortUrl}`,
                  "_blank"
                );
                //  increase visit count
                setVisitCountState(visitCountState + 1);
              }}
            >
              <FaExternalLinkAlt /> Visit The Site
            </Button>
            <Button variant={"danger"} onClick={deleteUrl}>
              <FaTrashAlt /> Delete
            </Button>
          </div>
        </Card.Body>
      </Card>
    );
  } else {
    return null;
  }
}

export default HistoryCard;
