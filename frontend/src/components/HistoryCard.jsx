import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { FaRegChartBar, FaExternalLinkAlt, FaTrashAlt } from 'react-icons/fa';
import { Dropdown } from 'react-bootstrap';
import PropTypes from 'prop-types';

function HistoryCard({
  shortUrl,
  originalUrl,
  visitCount,
  category,
  categoryArray,
}) {
  const [urlId, setUrlId] = useState('');
  const [showCard, setShowCard] = useState(true);
  const [visitCountState, setVisitCountState] = useState(visitCount);
  const [categoryState, setCategoryState] = useState(category);

  useEffect(() => {
    setUrlId(shortUrl);
  }, [shortUrl]);

  const deleteUrl = async () => {
    try {
      const result = await axios.delete(
        `${import.meta.env.VITE_API_ENDPOINT}/api/delete/${urlId}`,
        {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        },
      );
      // console.log(result);
      if (result.status === 200) {
        toast.success('URL Deleted Successfully');
        setShowCard(false);
      }
    } catch (error) {
      //
      console.error(error);
      toast.error(error.data.response.error);
    }
  };

  // extracting domain name from url
  const getDomainName = (url) => {
    const domainName = url.replace(/(^\w+:|^)\/\//, '').split('/')[0];
    return domainName;
  };

  const updateCategory = async (e) => {
    try {
      console.log(`update category api is called`);
      const result = await axios.put(
        `${import.meta.env.VITE_API_ENDPOINT}/api/url/filter/`,
        {
          shortUrl: shortUrl,
          category: e.target.innerText,
        },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        },
      );
      // console.log(result);
      if (result.status === 200) {
        setCategoryState(e.target.innerText);
        toast.success('Category Updated Successfully');
      }
    } catch (error) {
      console.error(error);
      toast.error(error.data.response.error);
    }
  };

  if (showCard) {
    return (
      <Card border="secondary">
        <Card.Header as="h5">
          {getDomainName(originalUrl)}

          <div>
            <Button
              variant={'danger'}
              onClick={deleteUrl}
              className="float-end"
              style={{ marginTop: '-1.5rem' }}
            >
              <FaTrashAlt />
            </Button>
          </div>
        </Card.Header>
        <Card.Body>
          <Card.Title as={'h6'}>{`${
            import.meta.env.VITE_API_ENDPOINT
          }/u/${shortUrl}`}</Card.Title>
          <Card.Text>{originalUrl}</Card.Text>
        </Card.Body>
        <div className="card-footer text-body-secondary d-flex gap-2 justify-content-around">
          <Dropdown>
            <Dropdown.Toggle variant="success" id="dropdown-basic">
              {categoryState || 'Select Category'}
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
          <div className="vr"></div>
          <Button
            variant="secondary"
            onClick={() => {
              //    open in new tab
              window.open(
                `${import.meta.env.VITE_API_ENDPOINT}/u/${shortUrl}`,
                '_blank',
              );
              //  increase visit count
              setVisitCountState(visitCountState + 1);
            }}
          >
            <FaExternalLinkAlt /> Visit The Site
          </Button>
          <div className="vr"></div>
          <div className="d-flex justify-content-center align-items-center text-xl">
            <FaRegChartBar /> <span className="ps-2">{visitCountState}</span>
          </div>
        </div>
      </Card>
    );
  } else {
    return null;
  }
}

HistoryCard.propTypes = {
  shortUrl: PropTypes.string.isRequired,
  originalUrl: PropTypes.string.isRequired,
  visitCount: PropTypes.number.isRequired,
  category: PropTypes.string,
  categoryArray: PropTypes.array,
};

export default HistoryCard;
