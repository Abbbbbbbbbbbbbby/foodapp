import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getToken } from './store/auth';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import VerifyPage from './pages/VerifyPage';
import HomePage from './pages/HomePage';
import EnterPage from './pages/EnterPage';

function ProtectedLayout() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/enter" element={<EnterPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
