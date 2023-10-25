import React, { useState } from 'react';
import HistoryCard from './HistoryCard';

const Pagination = ({ history, cardsPerPage, categoryArray }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(history.length / cardsPerPage);

  const handleClick = (e, page) => {
    e.preventDefault();
    setCurrentPage(page);
  };

  const renderCards = () => {
    const indexOfLastCard = currentPage * cardsPerPage;
    const indexOfFirstCard = indexOfLastCard - cardsPerPage;
    const currentCards = history.slice(indexOfFirstCard, indexOfLastCard);

    return (
      <div>
        {currentCards.map((data, index) => (
          <div key={index} className="card my-3">
            <HistoryCard
              key={data._id}
              shortUrl={data.shortUrl}
              originalUrl={data.originalUrl}
              visitCount={data.visitCount || 0}
              category={data.category}
              categoryArray={categoryArray}
            />
          </div>
        ))}
      </div>
    );
  };

  const renderPageNumbers = () => {
    const pageNumbers = [];

    for (let i = 1; i <= totalPages; i++) {
      <nav aria-label="..." className="d-flex justify-center">
        <ul className="pagination pagination-md">
          {pageNumbers.push(
            <li
              key={i}
              className={`page-item ${currentPage === i ? 'active' : ''}`}
              aria-current="page"
            >
              <span onClick={(e) => handleClick(e, i)} className="page-link">
                {i}
              </span>
            </li>,
          )}
        </ul>
      </nav>;
    }

    return pageNumbers;
  };

  return (
    <div>
      <div className="card-container d-flex justify-content-center my-5">
        {renderCards()}
      </div>
      <ul className="pagination d-flex justify-content-center my-5">
        {renderPageNumbers()}
      </ul>
    </div>
  );
};

export default Pagination;
