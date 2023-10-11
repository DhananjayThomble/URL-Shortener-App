import * as React from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import MenuIcon from '@mui/icons-material/Menu';
import Container from '@mui/material/Container';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import InsertLinkIcon from '@mui/icons-material/InsertLink';
import HomeIcon from '@mui/icons-material/Home';
import InfoIcon from '@mui/icons-material/Info';
import LoginIcon from '@mui/icons-material/Login';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useContext } from "react";
import UserContext from "../context/UserContext";

const pages = [
  { name: 'Home', icon: <HomeIcon /> },
  { name: 'About', icon: <InfoIcon /> },
  { name: 'Login', icon: <LoginIcon /> },
  { name: 'Signup', icon: <PersonAddIcon /> },
];

const pagesAfterLogin = [
  { name: 'Home', icon: <HomeIcon /> },
  { name: 'About', icon: <InfoIcon /> },
  { name: 'History', icon: <LoginIcon /> },
  { name: 'Contributers', icon: <PersonAddIcon /> },
  { name: 'Logout', icon: <PersonAddIcon /> },
];

const settings = ['Profile', 'Account', 'Dashboard', 'Logout'];

function Navbar() {
  const context = useContext(UserContext);
  
  const [anchorElNav, setAnchorElNav] = React.useState(null);
  const [anchorElUser, setAnchorElUser] = React.useState(null);

  const handleOpenNavMenu = (event) => {
    setAnchorElNav(event.currentTarget);
  };
  const handleOpenUserMenu = (event) => {
    setAnchorElUser(event.currentTarget);
  };

  const handleCloseNavMenu = () => {
    setAnchorElNav(null);
  };

  const handleCloseUserMenu = () => {
    setAnchorElUser(null);
  };

  return (
    <AppBar position="static">
      <Container maxWidth="xl">
        <Toolbar disableGutters>
          <InsertLinkIcon sx={{ display: { xs: 'none', md: 'flex' }, mr: 1 }} />
          <Typography
            variant="h6"
            noWrap
            component="a"
            href="#app-bar-with-responsive-menu"
            sx={{
              mr: 2,
              display: { xs: 'none', md: 'flex' },
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: '.1rem',
              color: 'inherit',
              textDecoration: 'none',
            }}
          >
            SnapURL
          </Typography>
          <Box sx={{ flexGrow: 1, display: { xs: 'flex', md: 'none' } }}>
            <IconButton
              size="large"
              aria-label="account of current user"
              aria-controls="menu-appbar"
              aria-haspopup="true"
              onClick={handleOpenNavMenu}
              color="inherit"
            >
              <MenuIcon />
            </IconButton>
            <Menu
              id="menu-appbar"
              anchorEl={anchorElNav}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
              }}
              keepMounted
              transformOrigin={{
                vertical: 'top',
                horizontal: 'left',
              }}
              open={Boolean(anchorElNav)}
              onClose={handleCloseNavMenu}
              sx={{
                display: { xs: 'block', md: 'none' },
              }}
            >
              {pages.map((page) => (
                
        <MenuItem key={page.name} onClick={handleCloseNavMenu}>
          {page.icon}
          <Typography textAlign="center">{page.name}</Typography>
        </MenuItem>
      ))}
            </Menu>
          </Box>
          <InsertLinkIcon sx={{ display: { xs: 'flex', md: 'none' }, mr: 1 }} />
          <Typography
            variant="h5"
            noWrap
            component="a"
            href="#app-bar-with-responsive-menu"
            sx={{
              mr: 2,
              display: { xs: 'flex', md: 'none' },
              flexGrow: 1,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: '.3rem',
              color: 'inherit',
              textDecoration: 'none',
            }}
          >
            LOGO
          </Typography>
          <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' } }}>
  {context.user === null ? (
    pages.map((page) => (
      <MenuItem key={page.name} onClick={handleCloseNavMenu}>
        {page.icon} <a style={{ color: 'white', textDecoration: 'none' }} href={'/' + page.name}>
          <Typography textAlign="center">{page.name}</Typography> </a>
      </MenuItem>
    ))
  ) : (
    pagesAfterLogin.map((page) => (
      <MenuItem key={page.name} onClick={handleCloseNavMenu}>
        {page.icon} <a style={{ color: 'white', textDecoration: 'none' }} href={'/' + page.name}>
          <Typography textAlign="center">{page.name}</Typography> </a>
      </MenuItem>
    ))
  )}
</Box>
{context.user !== null && (
  <Box sx={{ flexGrow: 0 }}>
    <Tooltip title="Open settings">
      <IconButton onClick={handleOpenUserMenu} sx={{ p: 0 }}>
        <Avatar alt="Remy Sharp" src="/static/images/avatar/2.jpg" />
      </IconButton>
    </Tooltip>
    <Menu
      sx={{ mt: '45px' }}
      id="menu-appbar"
      anchorEl={anchorElUser}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      keepMounted
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      open={Boolean(anchorElUser)}
      onClose={handleCloseUserMenu}
    >
      {settings.map((setting) => (
        <MenuItem key={setting} onClick={handleCloseUserMenu}>
          <Typography textAlign="center">{setting}</Typography>
        </MenuItem>
      ))}
    </Menu>
  </Box>
)}

        </Toolbar>
      </Container>
    </AppBar>
  );
}
export default Navbar;                  