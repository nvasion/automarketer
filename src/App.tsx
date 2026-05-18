import { Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import './App.css'

function Home() {
  return (
    <main className="main">
      <h1>Welcome to silent-elk-bronze</h1>
      <p>A React application built with TypeScript</p>
      <div className="card">
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
    </main>
  )
}

function About() {
  return (
    <main className="main">
      <h1>About</h1>
      <p>This project was created with AI Project Factory.</p>
      <ul>
        <li>React 18 with TypeScript</li>
        <li>Vite for fast development</li>
        <li>React Router for navigation</li>
        <li>Vitest for testing</li>
      </ul>
    </main>
  )
}

function App() {
  return (
    <div className="app">
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </div>
  )
}

export default App
