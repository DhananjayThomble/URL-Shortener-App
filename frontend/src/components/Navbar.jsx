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
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import OfflineShareIcon from '@mui/icons-material/OfflineShare';
import InsertLinkIcon from '@mui/icons-material/InsertLink';
import HomeIcon from '@mui/icons-material/Home';
import InfoIcon from '@mui/icons-material/Info';
import LoginIcon from '@mui/icons-material/Login';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useContext } from 'react';
import UserContext from '../context/UserContext';
import { Link, NavLink } from 'react-router-dom';

const pages = [
  { name: 'Home', icon: <HomeIcon /> },
  { name: 'About', icon: <InfoIcon /> },
  { name: 'Contributors', icon: <PersonAddIcon /> },
  { name: 'Login', icon: <LoginIcon /> },
  { name: 'Linkinbio', icon: <OfflineShareIcon /> },
  { name: 'Signup', icon: <PersonAddIcon /> },
];

const pagesAfterLogin = [
  { name: 'Home', icon: <HomeIcon /> },
  { name: 'About', icon: <InfoIcon /> },
  { name: 'Contributors', icon: <PersonAddIcon /> },
  { name: 'Linkinbio', icon: <OfflineShareIcon /> },
  { name: 'History', icon: <LoginIcon /> },
  { name: 'Logout', icon: <PersonAddIcon /> },
];

// const settings = ["Profile", "Account", "Dashboard", "Logout"];
const settings = ['Logout'];

function Navbar() {
  const context = useContext(UserContext);
  const [user, setUser] = React.useState(null);

  const [anchorElNav, setAnchorElNav] = React.useState(null);
  const [anchorElUser, setAnchorElUser] = React.useState(null);

  React.useEffect(() => {
    // console.log(`Navbar: ${context.user}`);
    setUser(context.user);
  }, [context.user]);

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
    <AppBar style={{ backgroundColor: '#4B3F6B' }} position="static">
      <Container maxWidth="xl">
        <Toolbar disableGutters>
          <InsertLinkIcon sx={{ display: { xs: 'none', md: 'flex' }, mr: 1 }} />
          <Link style={{ color: 'white', textDecoration: 'none' }} to="/Home">
            <Typography
              variant="h6"
              noWrap
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
          </Link>
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
              {user === null
                ? pages.map((page) => (
                    <NavLink
                      key={page.name}
                      to={'/' + page.name}
                      style={({ isActive }) => {
                        return isActive
                          ? {
                              color: '#51087E',
                              background: '#51087E',
                              borderRadius: '5px',
                            }
                          : { color: 'black' };
                      }}
                    >
                      <MenuItem
                        onClick={handleCloseNavMenu}
                        selected={page.name === 'Home'}
                      >
                        {page.icon}

                        <Typography m="5px" textAlign="center">
                          {page.name}
                        </Typography>
                      </MenuItem>
                    </NavLink>
                  ))
                : pagesAfterLogin.map((page) => (
                    <NavLink
                      to={'/' + page.name}
                      key={page.name}
                      style={({ isActive }) => {
                        return isActive
                          ? {
                              color: '#51087E',
                              background: '#51087E',
                              borderRadius: '5px',
                            }
                          : { color: 'black' };
                      }}
                    >
                      <MenuItem onClick={handleCloseNavMenu}>
                        {page.icon}
                        <Typography m="5px" textAlign="center">
                          {page.name}
                        </Typography>
                      </MenuItem>
                    </NavLink>
                  ))}
            </Menu>
          </Box>

          {/* For lg */}
          <Box sx={{ flexGrow: 1, display: { xs: 'flex', md: 'none' } }}>
            <Link
              style={{ color: 'white', textDecoration: 'none' }}
              to={'/Home'}
            >
              <Typography
                variant="h5"
                noWrap
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
                <InsertLinkIcon
                  sx={{ display: { xs: 'flex', md: 'none' }, mr: 1, mt: 0.5 }}
                />
                SnapURL
              </Typography>
            </Link>
          </Box>
          <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' } }}>
            {user === null
              ? pages.map((page) => (
                  <NavLink
                    key={page.name}
                    to={'/' + page.name}
                    style={({ isActive }) => {
                      return isActive
                        ? {
                            color: 'white',
                            background: '#51087E',
                            padding: '0.1rem',
                            borderRadius: '5px',
                          }
                        : { color: 'white' };
                    }}
                  >
                    <MenuItem onClick={handleCloseNavMenu}>
                      <Typography display="flex" gap="4px" textAlign="center">
                        {page.icon}
                        {page.name}
                      </Typography>{' '}
                    </MenuItem>
                  </NavLink>
                ))
              : pagesAfterLogin.map((page) => (
                  <NavLink
                    to={'/' + page.name}
                    key={page.name}
                    style={({ isActive }) => {
                      return isActive
                        ? {
                            color: 'white',
                            background: '#51087E',
                            padding: '0.1rem',
                            borderRadius: '5px',
                          }
                        : { color: 'white' };
                    }}
                  >
                    <MenuItem onClick={handleCloseNavMenu}>
                      <Typography display="flex" gap="4px" textAlign="center">
                        {page.icon}
                        {page.name}
                      </Typography>{' '}
                    </MenuItem>
                  </NavLink>
                ))}
          </Box>
          {user !== null && (
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
                  <NavLink to={'/' + setting} key={setting}>
                    <MenuItem key={setting} onClick={handleCloseUserMenu}>
                      <Typography textAlign="center">{setting}</Typography>
                    </MenuItem>
                  </NavLink>
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
