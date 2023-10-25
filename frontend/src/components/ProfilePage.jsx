import React, { useEffect, useState } from 'react';
import {
  FaInstagram,
  FaLinkedin,
  FaGithub,
  FaFacebook,
  FaUser,
  FaShare,
} from 'react-icons/fa';
import './linkinbio.css';
function ProfilePage() {
  const [name, setName] = useState('');
  const [profilePicture, setProfilePicture] = useState('');
  const [links, setLinks] = useState([
    { label: 'Instagram', url: '' },
    { label: 'LinkedIn', url: '' },
    { label: 'GitHub', url: '' },
    { label: 'Facebook', url: '' },
  ]);

  useEffect(() => {
    // Retrieve the user's details from localStorage or a backend server
    // For this example, we'll use localStorage
    setName(localStorage.getItem('name'));
    setProfilePicture(localStorage.getItem('profilePicture'));

    // Retrieve the links array from localStorage
    const storedLinks = JSON.parse(localStorage.getItem('links')) || [];

    // Update the links based on the retrieved data
    const updatedLinks = links.map((link) => {
      const storedLink = storedLinks.find(
        (stored) => stored.label === link.label,
      );
      if (storedLink) {
        return storedLink;
      }
      return link;
    });

    setLinks(updatedLinks);
  }, [links]); // Include 'links' as a dependency

  const instagramLink = links.find((link) => link.label === 'Instagram').url;
  const linkedinLink = links.find((link) => link.label === 'LinkedIn').url;
  const githubLink = links.find((link) => link.label === 'GitHub').url;
  const facebookLink = links.find((link) => link.label === 'Facebook').url;

  return (
    <div className="profile-page">
      <div className="center-content">
        <h1>Your Profile</h1>
        <div>
          <div className="profile-picture">
            {profilePicture ? (
              <img src={profilePicture} alt={name} />
            ) : (
              <FaUser className="fadummyuser" />
            )}
          </div>
          <h2>{name}</h2>
        </div>
        <div>
          <h3>Social Media Links</h3>
          {instagramLink || linkedinLink || githubLink || facebookLink ? (
            <div className="icon-row">
              {instagramLink && (
                <a
                  href={instagramLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FaInstagram className="icon" />
                </a>
              )}
              {linkedinLink && (
                <a
                  href={linkedinLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FaLinkedin className="icon" />
                </a>
              )}
              {githubLink && (
                <a href={githubLink} target="_blank" rel="noopener noreferrer">
                  <FaGithub className="icon" />
                </a>
              )}
              {facebookLink && (
                <a
                  href={facebookLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FaFacebook className="icon" />
                </a>
              )}
            </div>
          ) : (
            <p>No social media links</p>
          )}
        </div>
        <button className="btn">
          <FaShare className="icon" />
          Share
        </button>
      </div>
    </div>
  );
}

export default ProfilePage;
