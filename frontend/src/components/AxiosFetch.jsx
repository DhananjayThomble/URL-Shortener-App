// import { set } from "mongoose";
import { useState, useEffect } from 'react';
import axios from 'axios';

const AxiosFetch = (url) => {
  const [data, setData] = useState(null);
  const [isPending, setIsPending] = useState(true);
  const [error, setError] = useState(null);
  // 'http://localhost:8000/blogs'
  useEffect(() => {
    const abortCont = new AbortController();
    axios
      .get(url)
      .then((data) => {
        // console.log("axios fetch",data.data);
        setData(data.data);
        setIsPending(false);
        setError(null);
      })
      .catch((err) => {
        if (err.name === 'AbortError') {
          console.log('fetch aborted');
        } else {
          setIsPending(false);
          setError(err.message);
        }
      });
    return () => abortCont.abort();
  }, [url]); //empty dependency array prevents the useEffect from running for every change
  // console.log('axios',data);
  return { data, isPending, error };
};

export default AxiosFetch;
