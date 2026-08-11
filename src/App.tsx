/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import PublicVerification from './components/PublicVerification';
import AdminLogin from './components/AdminLogin';
import AdminDashboard from './components/AdminDashboard';
import { Home, ExternalLink, HelpCircle, FileCheck, Award, Users } from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState<'verify' | 'admin-login' | 'admin-dashboard'>('verify');
  
  // Authentication states
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  
  // URL verification path detection
  const [initialVerificationId, setInitialVerificationId] = useState('');

  // Check state on loader boot
  useEffect(() => {
    // 1. Robust multi-mode routing for static hosts and clean domains
    const path = window.location.pathname;
    const hash = window.location.hash;
    const searchParams = new URLSearchParams(window.location.search);
    
    let matchId = '';
    
    // Mode A: Clean URL path (e.g., /verify/BD-AP-2026-12345 or /BD-AP-2026-95851)
    if (path.toLowerCase().includes('/verify/')) {
      const parts = path.split(/\/verify\//i);
      if (parts[1]) {
        const rawToken = parts[1].split('/')[0].split('?')[0].trim();
        if (rawToken) {
          matchId = decodeURIComponent(rawToken);
        }
      }
    } else if (path !== '/' && path.length > 1) {
      const segments = path.split('/').filter(Boolean);
      if (segments.length > 0) {
        const lastSeg = decodeURIComponent(segments[segments.length - 1].trim());
        const reserved = ['api', 'assets', 'index.html', 'favicon.ico', 'admin', 'login', 'dashboard', 'verify', 'public', 'auth', 'register'];
        if (lastSeg && !reserved.includes(lastSeg.toLowerCase())) {
          matchId = lastSeg;
        }
      }
    }
    
    // Mode B: Hash routing fallback (e.g., #/verify/BD-AP-2026-12345 or #BD-AP-2026-12345)
    if (!matchId && hash) {
      if (hash.toLowerCase().includes('verify/')) {
        const parts = hash.split(/verify\//i);
        if (parts[1]) {
          const rawToken = parts[1].split('/')[0].split('?')[0].trim();
          if (rawToken) {
            matchId = decodeURIComponent(rawToken);
          }
        }
      } else {
        const cleanHash = hash.replace(/^#\/?/, '').trim();
        const reserved = ['verify', 'admin', 'login', 'dashboard', 'api'];
        if (cleanHash && !reserved.includes(cleanHash.toLowerCase())) {
          matchId = decodeURIComponent(cleanHash);
        }
      }
    }
    
    // Mode C: Query Parameter fallback (e.g., ?id=BD-AP-2026-12345 or ?verify=BD-AP-2026-12345)
    if (!matchId) {
      const qId = searchParams.get('id') || searchParams.get('verify') || searchParams.get('token');
      if (qId) {
        matchId = qId.trim();
      }
    }
    
    if (matchId) {
      setInitialVerificationId(matchId);
      setCurrentView('verify');
    }

    // 2. Load stored active login session
    const storedToken = localStorage.getItem('MoFA_AdminToken');
    if (storedToken) {
      verifyStoredToken(storedToken);
    }
  }, []);

  const verifyStoredToken = async (token: string) => {
    try {
      const res = await fetch('/api/auth/verify-token', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setIsAdminLoggedIn(true);
        setAdminToken(token);
        // If they were on login view, send them to dashboard
        if (currentView === 'admin-login') {
          setCurrentView('admin-dashboard');
        }
      } else {
        localStorage.removeItem('MoFA_AdminToken');
      }
    } catch (e) {
      // Offline fallback
      localStorage.removeItem('MoFA_AdminToken');
    }
  };

  const handleLoginSuccess = (token: string, username: string) => {
    localStorage.setItem('MoFA_AdminToken', token);
    setIsAdminLoggedIn(true);
    setAdminToken(token);
    setCurrentView('admin-dashboard');
  };

  const handleLogout = () => {
    localStorage.removeItem('MoFA_AdminToken');
    setIsAdminLoggedIn(false);
    setAdminToken('');
    setCurrentView('verify');
  };

  // Nav helper resetting transient search params
  const handleNavigate = (view: 'verify' | 'admin-login' | 'admin-dashboard') => {
    if (view === 'verify') {
      // Clear path when returning to clean search portal (handles custom domains or subpaths)
      const currentPath = window.location.pathname;
      let basePath = '/';
      if (currentPath.includes('/verify/')) {
        basePath = currentPath.split('/verify/')[0] + '/';
      }
      basePath = basePath.replace(/\/+/g, '/');
      if (currentPath !== basePath) {
        window.history.pushState({}, '', basePath);
        setInitialVerificationId('');
      }
    }
    setCurrentView(view);
  };

  return (
    <div className={`min-h-screen ${currentView === 'verify' ? 'bg-white' : 'bg-[#f8fafc]'} flex flex-col font-sans transition-all duration-300`}>
      
      {/* Global Navigation Header logo panel (hidden for public verify view to avoid double header) */}
      {currentView !== 'verify' && (
        <Header 
          currentView={currentView}
          onNavigate={handleNavigate}
          isAdminLoggedIn={isAdminLoggedIn}
          onLogout={handleLogout}
        />
      )}

      {/* Main interactive window area */}
      <main className="flex-grow">
        {currentView === 'verify' && (
          <PublicVerification 
            initialId={initialVerificationId}
            onClearInitialId={() => setInitialVerificationId('')}
            onNavigate={handleNavigate}
          />
        )}

        {currentView === 'admin-login' && (
          <AdminLogin 
            onLoginSuccess={handleLoginSuccess}
            onCancel={() => handleNavigate('verify')}
          />
        )}

        {currentView === 'admin-dashboard' && (
          <AdminDashboard 
            token={adminToken}
            onLogout={handleLogout}
          />
        )}
      </main>

      {/* Bangladesh Govt Official Footer */}
      <footer className="bg-[#f0f4f8] border-t border-gray-200 py-6 text-gray-800">
        <div className="max-w-xl mx-auto px-4 flex flex-col items-center">
          
          {/* Top Row: Crest and Copyright text (Perfect Center Alignment) */}
          <div className="flex flex-col items-center justify-center text-center mb-5 w-full">
            <img 
              src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQrvFusyT0sOsrNeafPm_oPJdc-Wxqk0MQSSQ&s"
              alt="BD Crest"
              className="w-12 h-12 object-contain mix-blend-multiply bg-transparent mb-2.5"
              referrerPolicy="no-referrer"
            />
            <div className="font-sans text-gray-800">
              <h4 className="text-[14px] sm:text-[16px] font-black tracking-tight text-slate-800 leading-normal text-center">
                কপিরাইট © ২০২৩ সর্বস্বত্ব সংরক্ষিত
              </h4>
              <p className="text-[12px] sm:text-[14px] font-black text-[#006a4e] leading-normal mt-0.5 text-center">
                গণপ্রজাতন্ত্রী বাংলাদেশ সরকার
              </p>
            </div>
          </div>

          <hr className="w-full border-gray-250 mb-4" />

          {/* Bottom Row: Implementation Agency & Logos Stack */}
          <div className="w-full flex flex-col items-center justify-center gap-3 text-center">
            <span 
              onClick={() => setCurrentView('admin-login')}
              className="text-[11px] sm:text-[13px] font-black text-slate-700 whitespace-nowrap cursor-pointer hover:text-slate-900 select-none"
              title="পরিকল্পনা বাস্তবায়নে"
            >
              পরিকল্পনা বাস্তবায়নে:
            </span>
            
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
              {/* BD Crest Circular Red Seal */}
              <img 
                src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTJJoM-apq0r7N7yXH4OZFhWBYS29zFlH9bBZu3wOhWneL0iRGp_wKvnZY&s=10"
                alt="BD Govt Seal"
                className="h-8 sm:h-10 w-auto object-contain mix-blend-multiply bg-transparent"
                referrerPolicy="no-referrer"
              />
              {/* Cabinet Division */}
              <img 
                src="https://upload.wikimedia.org/wikipedia/commons/5/57/Cabinet_Division.svg"
                alt="Cabinet"
                className="h-8 sm:h-10 w-auto object-contain mix-blend-multiply bg-transparent"
                referrerPolicy="no-referrer"
              />
              {/* ICT Division */}
              <img 
                src="https://upload.wikimedia.org/wikipedia/commons/9/91/Information_and_Communication_Technology_Division.svg"
                alt="ICT"
                className="h-8 sm:h-10 w-auto object-contain mix-blend-multiply bg-transparent"
                referrerPolicy="no-referrer"
              />
              {/* UNDP */}
              <img 
                src="https://www.unwater.org/sites/default/files/styles/d04/public/app/uploads/2017/05/100x120_members_UNDP.webp?itok=qG7vY7nq"
                alt="UNDP"
                className="h-8 sm:h-10 w-auto object-contain mix-blend-multiply bg-transparent"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>

        </div>
      </footer>

    </div>
  );
}
