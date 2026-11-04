import { useEffect } from 'react'
import { useLocation } from 'react-router'

// When you open a new page on a normal website, it starts at the top (or at
// the #section in the link). React Router switches pages without loading a
// new one, so this component does that scrolling by hand.
function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null
    if (target) target.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [pathname, hash])

  return null
}

export default ScrollToTop
