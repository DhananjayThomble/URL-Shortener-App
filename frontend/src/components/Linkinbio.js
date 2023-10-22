import React from 'react';
import ProfileForm from './ProfileForm';
import MyNavbar from "./Navbar";
import "../App.css";


function Linkinbio() {
  return (
    <div className="Linkinbio">
      {/* Render ProfileForm component */}
      <ProfileForm />
    </div>
  );
}

export default Linkinbio;