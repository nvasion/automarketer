// True while rendering a page that will be served without the app's scripts
// (the prerendered dist/404.html). Controls that need JavaScript, such as the
// theme switch, are left out there instead of showing buttons that do nothing.

import { createContext, useContext } from 'react'

export const StaticPageContext = createContext(false)

export const useStaticPage = () => useContext(StaticPageContext)
