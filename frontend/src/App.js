import { BrowserRouter, Routes, Route } from "react-router-dom";

import './App.css';

import Home from './sections/Home';
import Originals from './sections/Originals';
import Covers from './sections/Covers';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/">
          <Route index element={<Home />} />
          <Route path="originals" element={<Originals />} />
          <Route path="covers" element={<Covers />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
