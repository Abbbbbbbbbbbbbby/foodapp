import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getToken, getUser } from './store/auth';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import VerifyPage from './pages/VerifyPage';
import HomePage from './pages/HomePage';
import EnterPage from './pages/EnterPage';
import AdminAccountsPage from './pages/AdminAccountsPage';
import RecordsPage from './pages/RecordsPage';
import ImportPage from './pages/ImportPage';
import DuplicatesPage from './pages/DuplicatesPage';
import ExportPage from './pages/ExportPage';

function ProtectedLayout() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Layout />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function StaffRoute({ children }: { children: React.ReactNode }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'volunteer') return <Navigate to="/" replace />;
  return <>{children}</>;
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
          <Route
            path="/admin/accounts"
            element={<AdminRoute><AdminAccountsPage /></AdminRoute>}
          />
          <Route
            path="/records"
            element={<StaffRoute><RecordsPage /></StaffRoute>}
          />
          <Route
            path="/admin/import"
            element={<AdminRoute><ImportPage /></AdminRoute>}
          />
          <Route
            path="/admin/duplicates"
            element={<AdminRoute><DuplicatesPage /></AdminRoute>}
          />
          <Route
            path="/admin/export"
            element={<StaffRoute><ExportPage /></StaffRoute>}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
