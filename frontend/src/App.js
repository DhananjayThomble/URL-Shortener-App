import { BrowserRouter, Routes, Route } from "react-router-dom";
import MyNavbar from "./components/Navbar";
import LandingPage from "./components/LandingPage/LandingPage";
import About from "./components/About";
import Login from "./components/Login";
import Signup from "./components/Signup";
import Logout from "./components/Logout";
// import Footer from "./components/Footer";
import History from "./components/History";
import "./App.css";
import UserContext from "./context/UserContext";
import { useState } from "react";
import Contributers from "./components/Contributers";
import ResetPassword from "./components/ResetPassword";
// import LandingPage from "./components/LandingPage/LandingPage";

function App() {
  const [user, setUser] = useState(localStorage.getItem("token") || null);

  return (
    <div>
      <BrowserRouter>
        <UserContext.Provider value={{ user, setUser }}>
          <MyNavbar />
          <Routes>
            <Route index path="/" element={<LandingPage />} />
            <Route path="/about" element={<About />} />
            <Route path="/login" element={<Login />} />
            <Route path={"/signup"} element={<Signup />} />
            <Route path={"/logout"} element={<Logout />} />
            <Route path="*" element={<LandingPage />} />
            <Route path={"/history"} element={<History />} />
            <Route path={"/contributers"} element={<Contributers />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Routes>
          <Footer />
        </UserContext.Provider>
      </BrowserRouter>
    </div>
  );
}

export default App;
