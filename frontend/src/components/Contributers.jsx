import React, { useEffect, useState } from "react";
import styles from "./Contributers.module.css";
import axios from "axios";

function Contributers() {
  //Constants
  //Url to fetch contributers from github api
  const url =
    "https://api.github.com/repos/DhananjayThomble/URL-Shortener-App/contributors";

  //States
  const [isLoading, setIsLoading] = useState(false);
  const [listOfContributers, setListOfContributers] = useState([]);

  //Fetch list of contributers using github api
  useEffect(function () {
    async function fetchContributers(url) {
      try {
        setIsLoading(true);
        const res = await axios.get(`${url}`);
        setListOfContributers(res.data);
        console.log(res.data);
      } catch {
        throw new Error(
          "Error occured while fetching contributers data from github api."
        );
      } finally {
        setIsLoading(false);
      }
    }

    fetchContributers(url);
  }, []);

  if (isLoading) {
    return <div>Loading...</div>;
  } else {
    return (
      <div className={styles.mainContainer}>
        <h1>Our contributors:</h1>
        <div className={styles.listContainer}>
          {listOfContributers.map((i) => (
            <a className={styles.itemContainer} key={i.id} href={i.html_url}>
              <img src={i.avatar_url} alt="avatar"></img>
              <p>{i.login}</p>
            </a>
          ))}
        </div>
      </div>
    );
  }
}

export default Contributers;
