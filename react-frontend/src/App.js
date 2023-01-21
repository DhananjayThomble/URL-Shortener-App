import { BrowserRouter, Routes, Route } from "react-router-dom";
import MyNavbar from "./components/Navbar";
import Home from "./components/Home";
import About from "./components/About";
import Login from "./components/Login";
import Signup from "./components/Signup";
import Logout from "./components/Logout";

function App() {
  return (
    <div>
      <BrowserRouter>
        <MyNavbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/login" element={<Login />} />
          <Route path={"/signup"} element={<Signup />} />
          <Route path={"/logout"} element={<Logout />} />
          <Route path="*" element={"Error"} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
