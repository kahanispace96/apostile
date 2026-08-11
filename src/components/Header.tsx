/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShieldCheck, LogIn, Search, FileText } from 'lucide-react';

interface HeaderProps {
  currentView: 'verify' | 'admin-login' | 'admin-dashboard';
  onNavigate: (view: 'verify' | 'admin-login' | 'admin-dashboard') => void;
  isAdminLoggedIn: boolean;
  onLogout: () => void;
}

export default function Header({
  currentView,
  onNavigate,
  isAdminLoggedIn,
  onLogout
}: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-50">
      {/* Top green/red national flag ribbon */}
      <div className="h-1.5 w-full flex">
        <div className="h-full bg-[#006a4e] flex-1"></div>
        <div className="h-full bg-[#f42a41] w-[20%]"></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 sm:py-4 flex flex-row items-center justify-between gap-3">
        {/* Brand Logo as the Primary Headline */}
        <div 
          onClick={() => onNavigate('verify')}
          className="cursor-pointer group flex items-center gap-3 select-none py-0.5"
        >
          {/* Prominent Transparent National Seal Crest */}
          <img 
            src="https://upload.wikimedia.org/wikipedia/commons/8/84/Government_Seal_of_Bangladesh.svg" 
            alt="Government of Bangladesh Crest" 
            className="h-12 sm:h-16 w-auto flex-shrink-0 object-contain drop-shadow-sm transition-transform duration-200 group-hover:scale-[1.03]"
            referrerPolicy="no-referrer"
          />
          {/* myGov Branding */}
          <div className="flex flex-col justify-center leading-tight">
            <span className="text-2xl sm:text-3xl font-black tracking-tight font-sans">
              <span className="text-[#eb1c24]">my</span>
              <span className="text-[#008751]">Gov</span>
            </span>
            <span className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight whitespace-nowrap">
              এক ঠিকানায় সরকারি সেবা
            </span>
          </div>
        </div>

        {/* Right Side: Quick Portal Actions */}
        <div className="flex items-center gap-3 flex-wrap justify-center sm:justify-end">
          
          {/* Admin Controls - Hidden unless logged in */}
          {isAdminLoggedIn && (
            <>
              <button
                onClick={() => onNavigate('admin-dashboard')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-1.5 ${
                  currentView === 'admin-dashboard' 
                    ? 'bg-[#006a4e] text-white shadow-sm' 
                    : 'bg-[#006a4e]/10 text-[#006a4e] hover:bg-[#006a4e]/20'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Console
              </button>
              <button
                onClick={onLogout}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all duration-150"
              >
                Log Out
              </button>
            </>
          )}
          
          {!isAdminLoggedIn && (
            <button
              onClick={() => onNavigate('verify')}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-700 bg-gray-100/80 hover:bg-gray-100 transition-all"
            >
              Back to Home
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
