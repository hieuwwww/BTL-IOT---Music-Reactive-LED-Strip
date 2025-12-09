import { useState } from 'react';

const Auth = ({ apiBase, onAuth }) => {
  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'login') {
        const res = await fetch(`${apiBase}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Login failed');
        // data: { user, token, message }
        if (onAuth) onAuth(data.user, data.token);
      } else {
        const res = await fetch(`${apiBase}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Register failed');
        // After register server returns token + user
        if (onAuth) onAuth(data.user, data.token);
      }
    } catch (err) {
      setError(err.message || 'Lỗi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md p-8 rounded-xl shadow-xl bg-white dark:bg-gray-800">
        <h2 className="text-2xl font-bold mb-4 text-center text-indigo-600">{mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Tên đăng nhập</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full px-3 py-2 rounded border" required />
          </div>
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full px-3 py-2 rounded border" required />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Mật khẩu</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="w-full px-3 py-2 rounded border" required />
          </div>

          {error && <div className="text-sm text-red-500">{error}</div>}

          <button disabled={loading} type="submit" className="w-full py-2 rounded bg-indigo-600 text-white font-medium">
            {loading ? 'Đang xử lý...' : (mode === 'login' ? 'Đăng nhập' : 'Đăng ký')}
          </button>
        </form>

        <div className="mt-4 text-center text-sm opacity-80">
          {mode === 'login' ? (
            <>
              Chưa có tài khoản? <button type="button" className="text-indigo-500 underline" onClick={() => setMode('register')}>Đăng ký</button>
            </>
          ) : (
            <>
              Đã có tài khoản? <button type="button" className="text-indigo-500 underline" onClick={() => setMode('login')}>Đăng nhập</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
