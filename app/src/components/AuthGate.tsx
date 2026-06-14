import { useState, useEffect, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { albireoTone } from '../albireo/shared/albireoTokens';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => !!localStorage.getItem('ombre_api_token')
  );
  const [showGate, setShowGate] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const handleAuthFailed = () => {
      setIsAuthenticated(false);
      setShowGate(true);
      localStorage.removeItem('ombre_api_token');
    };

    window.addEventListener('ombre-auth-failed', handleAuthFailed);
    return () => {
      window.removeEventListener('ombre-auth-failed', handleAuthFailed);
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const token = password.trim();
    if (!token) {
      setError('Tell me it’s you.');
      return;
    }
    
    try {
      const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
      const res = await fetch(`${API_BASE_URL}/auth/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok || res.status !== 401) {
        localStorage.setItem('ombre_api_token', token);
        setIsAuthenticated(true);
        setShowGate(false);
        setError('');
      } else {
        setError('Incorrect.');
      }
    } catch (err) {
      setError('Connection failed.');
    }
  };

  if (!showGate && isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div 
      className={cn("fixed inset-0 z-[9999] bg-black")}
      onClick={() => {
        if (isAuthenticated) setShowGate(false);
      }}
    >
      <img
        src="/welcome_page.JPG"
        alt="Welcome"
        className="absolute inset-0 h-full w-full object-cover opacity-80"
      />
      <div className="absolute inset-0 bg-black/20" />
      
      <div className="relative z-10 flex h-full flex-col items-center justify-center p-6">
        <AnimatePresence>
          {!isAuthenticated && (
            <motion.form
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex w-full max-w-[260px] flex-col gap-3 rounded-[20px] bg-black/50 p-6 shadow-2xl backdrop-blur-xl border border-white/10"
              onSubmit={handleSubmit}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-1">
                <p className="text-sm font-medium text-white/80">Tell me it’s you.</p>
              </div>
              
              <input
                type="password"
                autoFocus
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-center text-base text-white placeholder-white/30 outline-none ring-1 ring-white/10 transition-all focus:ring-2 focus:ring-white/40"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              
              <button
                type="submit"
                className="hidden"
              >
                Submit
              </button>
              
              {error && (
                <p className="text-center text-xs text-red-400/90">{error}</p>
              )}
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
