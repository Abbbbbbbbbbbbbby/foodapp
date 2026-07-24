import { useNavigate } from 'react-router-dom';
import { getUser } from '../store/auth';

export default function HomePage() {
  const navigate = useNavigate();
  const user = getUser()!;

  return (
    <div className="home-page">
      <h1>Welcome, {user.name}</h1>
      <div className="home-buttons">
        <button className="btn-primary btn-large" onClick={() => navigate('/enter')}>
          Enter Data / Ingresar datos
        </button>
        {(user.role === 'staff' || user.role === 'admin') && (
          <button className="btn-secondary btn-large" onClick={() => navigate('/records')}>
            View Records / Ver registros
          </button>
        )}
        {user.role === 'admin' && (
          <button className="btn-secondary btn-large" onClick={() => navigate('/admin/accounts')}>
            Manage Accounts
          </button>
        )}
        {user.role === 'admin' && (
          <button className="btn-secondary btn-large" onClick={() => navigate('/admin/import')}>
            Import from Bubble
          </button>
        )}
      </div>
    </div>
  );
}
