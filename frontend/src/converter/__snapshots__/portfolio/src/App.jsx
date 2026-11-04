import { Route, Routes } from 'react-router'
import ScrollToTop from './ScrollToTop.jsx'
import HomePage from './pages/HomePage.jsx'
import AboutPage from './pages/AboutPage.jsx'

// Each page of your site is now a component. React Router shows the one whose
// path matches the URL, without loading a new HTML file.
function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<p>Page not found</p>} />
      </Routes>
    </>
  )
}

export default App
