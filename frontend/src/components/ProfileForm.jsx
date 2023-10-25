import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaUser,
  FaFileImage,
  FaInstagram,
  FaLinkedin,
  FaGithub,
  FaFacebook,
  FaCopy,
  FaTrash,
  FaQrcode,
} from 'react-icons/fa';
import QRCode from 'qrcode.react';
import './linkinbio.css';

function ProfileForm() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [profilePicture, setProfilePicture] = useState('');
  const [links, setLinks] = useState([
    { label: 'Instagram', url: '' },
    { label: 'LinkedIn', url: '' },
    { label: 'GitHub', url: '' },
    { label: 'Facebook', url: '' },
  ]);
  const [qrCodeVisible, setQRCodeVisible] = useState(false);

  useEffect(() => {
    // Retrieve user data from local storage
    const storedName = localStorage.getItem('name');
    if (storedName) setName(storedName);

    const storedProfilePicture = localStorage.getItem('profilePicture');
    if (storedProfilePicture) setProfilePicture(storedProfilePicture);

    const storedLinks = JSON.parse(localStorage.getItem('links'));
    if (storedLinks) setLinks(storedLinks);
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setProfilePicture(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLinkChange = (index, url) => {
    const updatedLinks = [...links];
    updatedLinks[index].url = url;
    setLinks(updatedLinks);
  };

  const handleCopy = () => {
    // Copy details to clipboard
    var detailsToCopy = `Name: ${name}\n\n`;
    links.forEach((link) => {
      detailsToCopy += `${link.label}: ${link.url}\n`;
    });

    // Use the Clipboard API to copy the text
    navigator.clipboard
      .writeText(detailsToCopy)
      .then(() => {
        alert('Details copied to clipboard!');
      })
      .catch((err) => {
        console.error('Failed to copy to clipboard:', err);
      });
  };

  const handleDiscard = () => {
    // Clear all details
    setName('');
    setProfilePicture('');
    const clearedLinks = links.map((link) => ({ ...link, url: '' }));
    setLinks(clearedLinks);
  };

  const handleQRCode = () => {
    setQRCodeVisible(true);
  };

  const closeQRCode = () => {
    setQRCodeVisible(false);
  };

  const handleSubmit = () => {
    localStorage.setItem('name', name);
    localStorage.setItem('profilePicture', profilePicture);
    localStorage.setItem('links', JSON.stringify(links));
    navigate('/linkinbio/profile');
  };

  return (
    <div className="profile-form">
      <div className="navbar">
        <button className="navbar-button" onClick={handleCopy}>
          <FaCopy className="icon" />
          Copy
        </button>
        <button className="navbar-button" onClick={handleDiscard}>
          <FaTrash className="icon" />
          Discard
        </button>
        <button className="navbar-button" onClick={handleQRCode}>
          <FaQrcode className="icon" />
          QR Code
        </button>
      </div>
      {qrCodeVisible && (
        <div className="qr-code-overlay">
          <div className="qr-code-popup">
            <QRCode value="https://example.com" size={128} />{' '}
            {/* Replace with your actual link */}
            <button onClick={closeQRCode}>X</button>
          </div>
        </div>
      )}
      <div className="center-content">
        <div className="xyz">
          <h1>Link-in-Bio</h1>
        </div>
        <form>
          {/* ... Rest of the form inputs */}
          <div className="input-container">
            <div className="left-label">
              <FaUser className="icon" />
              <label>Name</label>
            </div>
            <input
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="input-container">
            <div className="left-label">
              <FaFileImage className="icon" />
              <label>Profile Picture</label>
            </div>
            <input
              className="input"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
            />
          </div>
          {links.map((link, index) => (
            <div className="input-container" key={index}>
              <div className="left-label">
                {link.label === 'Instagram' && <FaInstagram className="icon" />}
                {link.label === 'LinkedIn' && <FaLinkedin className="icon" />}
                {link.label === 'GitHub' && <FaGithub className="icon" />}
                {link.label === 'Facebook' && <FaFacebook className="icon" />}
                <label>{link.label}</label>
              </div>
              <input
                className="input"
                type="text"
                value={link.url}
                onChange={(e) => handleLinkChange(index, e.target.value)}
              />
            </div>
          ))}
          <button className="btn" onClick={handleSubmit}>
            Publish
          </button>
        </form>
      </div>
    </div>
  );
}

export default ProfileForm;
