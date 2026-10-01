import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import Container from 'react-bootstrap/Container';
import Nav from 'react-bootstrap/Nav';
import Navbar from 'react-bootstrap/Navbar';

import './App.css';

import Home from './sections/Home';
import Originals from './sections/Originals';
import Covers from './sections/Covers';
import CoversCards from './sections/CoversCards';
import BandDetail from './sections/BandDetail';

const NAV_ITEMS = [
  { label: 'Home', path: '/' },
  { label: 'Originals', path: '/originals' },
  { label: 'Covers', path: '/covers' },
  { label: 'Cover Cards', path: '/covers-cards' },
  { label: 'Band Detail', path: '/band-detail' },
];

function AppNavigation() {
  const location = useLocation();
  const getHref = (pathname) => `${pathname}${window.location.search || location.search}`;

  return (
    <Navbar expand="lg" variant="light" collapseOnSelect className="app-navbar">
      <Container fluid="xxl">
        <Navbar.Brand href={getHref('/')} className="app-navbar-brand">
          Covers &amp; Relationships
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="app-primary-navigation" />
        <Navbar.Collapse id="app-primary-navigation">
          <Nav className="ms-auto">
            {NAV_ITEMS.map(({ label, path }) => (
              <Nav.Link
                key={path}
                href={getHref(path)}
                active={location.pathname === path}
                aria-current={location.pathname === path ? 'page' : undefined}
                eventKey={path}
              >
                {label}
              </Nav.Link>
            ))}
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppNavigation />
      <Routes>
        <Route path="/">
          <Route index element={<Home />} />
          <Route path="originals" element={<Originals />} />
          <Route path="covers" element={<Covers />} />
          <Route path="covers-cards" element={<CoversCards />} />
          <Route path="band-detail" element={<BandDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
