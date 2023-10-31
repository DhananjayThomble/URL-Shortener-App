import React, { useState } from 'react';
import './FeedbackForm.css';
import Image from '../assets/images/feedback.png';
import { toast } from 'react-toastify';
import axios from 'axios';

const FeedbackForm = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [attachment, setAttachment] = useState(null);
  // TODO: Implement attachments later
  const [feedback, setFeedback] = useState('');
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [fileInputKey, setFileInputKey] = useState(0);

  const handleAttachmentChange = (event) => {
    setAttachment(event.target.files[0]);
  };

  const resetState = () => {
    setName('');
    setEmail('');
    setFeedback('');
    setAttachment(null);
    setFileInputKey((prevKey) => prevKey + 1);
  };

  const isNameValid = (input) => {
    const namePattern = /^[a-zA-Z\s-]*$/;
    return namePattern.test(input);
  };

  const isEmailValid = (input) => {
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
    return emailPattern.test(input);
  };

  const handleSubmit = async () => {
    let isFormValid = true;
    setEmailError('');
    setNameError('');
    setFeedbackError('');

    if (!isNameValid(name) || !name) {
      setNameError('Please enter a valid name.');
      isFormValid = false;
    }

    if (!isEmailValid(email) || !email) {
      setEmailError('Please enter a valid email address.');
      isFormValid = false;
    }

    if (!feedback) {
      setFeedbackError('Please enter your feedback');
      isFormValid = false;
    }

    if (isFormValid) {
      // Submit form details to the API
      const apiEndpoint = `${import.meta.env.VITE_API_ENDPOINT}/auth/feedback`;

      try {
        const response = await axios.post(
          apiEndpoint,
          {
            message: feedback,
            rating: 5,
          },
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
          },
        );
        console.log(response.status);

        toast.success('Submitted');
        resetState();
      } catch (error) {
        if (error.response.status === 400) {
          const { error: errorMsg } = error.response.data;
          console.log(error, errorMsg);

          toast.error(errorMsg);
        } else if (
          error.response.status === 404 ||
          error.response.status === 401
        ) {
          toast.error('Please log in or sign up first!');
        } else {
          toast.error('Something went wrong. Please try again later.');
        }
      }
    }
  };

  return (
    <div className="feedback__form__container">
      <div className="feedback__form">
        <div className="feedback__form__img">
          <img src={Image} className="feedback__img" alt="Feedback" />
        </div>
        <div className="feedback__form__details">
          <div className="field">
            <input
              type="text"
              placeholder="What's your name?"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="line"></div>
          </div>
          {nameError && <p className="error__message">{nameError}</p>}
          <div className="field">
            <input
              type="text"
              placeholder="What's your email ID?"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="line"></div>
          </div>
          {emailError && <p className="error__message">{emailError}</p>}
          <div className="field">
            <input
              type="file"
              key={fileInputKey}
              placeholder="Enter relevant screenshots"
              onChange={(e) => handleAttachmentChange(e)}
            />
            <div className="line"></div>
          </div>
          <label>
            Feel free to report issues, give feedback, or contribute your
            suggestions.
          </label>
          <textarea
            className="text"
            placeholder="Enter Feedback or Suggestions"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          {feedbackError && <p className="error__message">{feedbackError}</p>}
          <div className="form__submit__btn">
            <button className="feedback__submit__btn" onClick={handleSubmit}>
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedbackForm;
