import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MyNavbar from './components/Navbar';
import LandingPage from './components/LandingPage/LandingPage';
import About from './components/About';
import Login from './components/Login';
import Signup from './components/Signup';
import Logout from './components/Logout';
// import Footer from "./components/Footer";
import History from './components/History';
import './App.css';
import UserContext from './context/UserContext';
import Contributors from './components/Contributors';
import React, { useState } from 'react';
import Linkinbio from './components/Linkinbio';
import ProfilePage from './components/ProfilePage';
import ResetPassword from './components/ResetPassword';
// import LandingPage from "./components/LandingPage/LandingPage";
// for react-toastify
import 'react-toastify/dist/ReactToastify.css';
import { ToastContainer } from 'react-toastify';
import SharePage from './components/Sharepage';
import ForgotPassword from './components/ForgotPassword';

function App() {
  const [user, setUser] = useState(localStorage.getItem('token') || null);

  return (
    <div>
      <BrowserRouter>
        <UserContext.Provider value={{ user, setUser }}>
          <MyNavbar />
          <ToastContainer />
          <Routes>
            <Route index path="/" element={<LandingPage />} />
            <Route path="/about" element={<About />} />
            <Route path="/login" element={<Login />} />
            <Route path={'/signup'} element={<Signup />} />
            <Route path={'/logout'} element={<Logout />} />
            <Route path="*" element={<LandingPage />} />
            <Route path={'/history'} element={<History />} />
            <Route path={'/contributors'} element={<Contributors />} />
            <Route path={'/linkinbio/*'} element={<Linkinbio />} />{' '}
            {/* Use /linkinbio/* */}
            <Route path={'/linkinbio/profile'} element={<ProfilePage />} />{' '}
            {/* Use /linkinbio/* */}
            <Route path="/reset-password/" element={<ResetPassword />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path={'/Sharepage'} element={<SharePage />} />
          </Routes>
          {/* <Footer /> */}
        </UserContext.Provider>
      </BrowserRouter>
    </div>
  );
}

export default App;
