import React, { useState } from 'react';
import shortid from 'shortid';
import { CopyToClipboard } from 'react-copy-to-clipboard'; // Import the CopyToClipboard component
import './Sharepage.css'; // Import the CSS file

const Sharepages = () => {
  const [longUrl, setLongUrl] = useState('');
  const [shortUrl, setShortUrl] = useState('');
  const [copied, setCopied] = useState(false); // State to track if the link is copied
  const [platform, setPlatform] = useState('');

  const handleShorten = () => {
    const shortId = shortid.generate();
    const shortenedUrl = `https://yourshorteningservice.com/${shortId}`;
    setShortUrl(shortenedUrl);
    setCopied(false); // Reset the copied state
  };

  const handleShare = () => {
    if (platform === 'twitter') {
      window.open(
        `https://twitter.com/intent/tweet?text=${shortUrl}`,
        '_blank',
      );
    } else if (platform === 'facebook') {
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${shortUrl}`,
        '_blank',
      );
    } else if (platform === 'linkedin') {
      // Share on LinkedIn
      window.open(
        `https://www.linkedin.com/sharing/share-offsite/?url=${shortUrl}`,
        '_blank',
      );
    } else if (platform === 'whatsapp') {
      window.open(`https://api.whatsapp.com/send?text=${shortUrl}`, '_blank');
    } else {
      alert('Unsupported platform.');
    }
  };

  return (
    <div className="share-pages-container">
      <input
        type="text"
        className="url-input"
        placeholder="Enter a long URL"
        value={longUrl}
        onChange={(e) => setLongUrl(e.target.value)}
      />
      <button className="shorten-button" onClick={handleShorten}>
        Shorten
      </button>

      {shortUrl && (
        <div className="short-url-container">
          <p className="short-url-text">Shortened URL:</p>
          <p className="short-url">{shortUrl}</p>

          {/* Copy to Clipboard button */}
          <CopyToClipboard text={shortUrl} onCopy={() => setCopied(true)}>
            <button className="copy-link-button">
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </CopyToClipboard>

          <select
            className="platform-select"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            <option value="">Select a platform to share</option>
            <option value="twitter">Twitter</option>
            <option value="facebook">Facebook</option>
            <option value="linkedin">LinkedIn</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <button className="share-button" onClick={handleShare}>
            Share
          </button>
        </div>
      )}
    </div>
  );
};

export default Sharepages;
