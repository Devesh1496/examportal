import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import './Auth.css';

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`
          }
        });
        if (error) throw error;
        alert('Check your email for the confirmation link!');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) setError(error.message);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">K</div>
          <h1>ExamPortal</h1>
          <p>{isSignUp ? 'Create your account' : 'Welcome back'}</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleAuth} className="auth-form">
          <div className="form-group">
            <label>Email Address</label>
            <input 
              type="email" 
              placeholder="name@company.com" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input 
              type="password" 
              placeholder="••••••••" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Sign In')}
          </button>
        </form>

        <div className="auth-divider">
          <span>OR</span>
        </div>

        <button onClick={handleGoogleLogin} className="btn btn-outline btn-block btn-google">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
          Continue with Google
        </button>

        <div className="auth-footer">
          {isSignUp ? (
            <p>Already have an account? <span onClick={() => setIsSignUp(false)}>Sign In</span></p>
          ) : (
            <p>Don't have an account? <span onClick={() => setIsSignUp(true)}>Sign Up</span></p>
          )}
        </div>
      </div>
    </div>
  );
}
