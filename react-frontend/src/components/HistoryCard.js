import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { FaRegChartBar, FaExternalLinkAlt, FaTrashAlt } from "react-icons/fa";

function HistoryCard({ shortUrl, originalUrl, visitCount }) {
  const [urlId, setUrlId] = useState("");
  const [showCard, setShowCard] = useState(true);
  const [visitCountState, setVisitCountState] = useState(visitCount);

  useEffect(() => {
    setUrlId(shortUrl);
  }, [shortUrl]);

  const deleteUrl = async () => {
    try {
      const result = await axios.delete(
        `https://app.dhananjaythomble.me/api/v2/delete/${urlId}`,
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

  if (showCard) {
    return (
      <Card border="secondary">
        <Card.Header as="h5">
          Featured
          <div className={"float-end"}>
            <FaRegChartBar />
            <span style={{ color: "#EDC126" }}> {visitCountState}</span>
          </div>
        </Card.Header>
        <Card.Body>
          <Card.Title
            as={"h6"}
          >{`https://app.dhananjaythomble.me/api/v2/url/${shortUrl}`}</Card.Title>
          <Card.Text>{originalUrl}</Card.Text>
          <Button
            variant="secondary"
            onClick={() => {
              //    open in new tab
              window.open(
                `https://app.dhananjaythomble.me/api/v2/url/${shortUrl}`,
                "_blank"
              );
              //  increase visit count
              setVisitCountState(visitCountState + 1);
            }}
          >
            <FaExternalLinkAlt /> The Site
          </Button>
          <Button className={"m-2"} variant={"danger"} onClick={deleteUrl}>
            <FaTrashAlt /> Delete
          </Button>
        </Card.Body>
      </Card>
    );
  } else {
    return null;
  }
}

export default HistoryCard;
