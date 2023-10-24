import React from 'react';
import AxiosFetch from './AxiosFetch';
import Lottie from 'lottie-react';
import './Contributors.css';

import Circle from '@mui/icons-material/Circle';
import cont1 from '../assets/cont1.json';

function Contributors() {
  const { data, isPending, error } = AxiosFetch(
    'https://api.github.com/repos/DhananjayThomble/URL-Shortener-App/contributors',
  );
  return (
    <div className="contributors">
      <div className="contributors-main">
        <Lottie
          className="contributors-animation"
          animationData={cont1}
          loop={true}
        />
        <div className="contributrers-main-text">
          <h1>Github Contributors,</h1>
          <h2>
            Collaboration in Code: Where Ideas Converge and Innovations Thrive
            🚀
          </h2>
          <h3>#OpenSource #CodeUnity</h3>
        </div>
      </div>

      <h1 className="title">
        <Circle className="circle" />
        The Contributors
      </h1>

      {error && <div>{error}</div>}
      {isPending && <div className="loading"></div>}
      <div className="contributer-container">
        {data &&
          data.map((item) => (
            <a
              href={item.html_url}
              target="_blank"
              rel="noopener noreferrer"
              key={item.id}
            >
              <div className="profile" key={item.id}>
                <img src={item.avatar_url} alt="" />
                <h1>{item.login}</h1>
              </div>
            </a>
          ))}
      </div>
    </div>
  );
}

export default Contributors;
