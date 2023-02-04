import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";

function HistoryCard({ shortUrl, originalUrl }) {
  return (
    <Card border="secondary">
      <Card.Header as="h5">Featured</Card.Header>
      <Card.Body>
        <Card.Title
          as={"h6"}
        >{`https://app.dhananjaythomble.me/api/v2/url/${shortUrl}`}</Card.Title>
        <Card.Text>{originalUrl}</Card.Text>
        <Button
          variant="outline-secondary"
          onClick={() => {
            //    open in new tab
            window.open(
              `https://app.dhananjaythomble.me/api/v2/url/${shortUrl}`,
              "_blank"
            );
          }}
        >
          Visit The Site
        </Button>
      </Card.Body>
    </Card>
  );
}

export default HistoryCard;
