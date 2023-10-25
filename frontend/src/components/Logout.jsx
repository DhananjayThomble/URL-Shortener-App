import React, { useEffect, useContext } from 'react';
import UserContext from '../context/UserContext';
import { useNavigate } from 'react-router-dom';

function Logout() {
  const navigate = useNavigate();
  const context = useContext(UserContext);
  //  delete the token from local storage
  useEffect(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('name');

    context.setUser(null);
    navigate('/');
  }, [context, navigate]);

  return <div></div>;
}

export default Logout;
