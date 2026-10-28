import React from 'react';

export function PharmacyEmblem({ className = 'w-9 h-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="pharmaTealGrad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#11998E" />
          <stop offset="100%" stopColor="#07534E" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#pharmaTealGrad)" />
      {/* Outlined Rounded Medical Cross matching reference ERP emblem */}
      <path
        d="M17.2 10.5C17.2 9.67157 17.8716 9 18.7 9H21.3C22.1284 9 22.8 9.67157 22.8 10.5V17.2H29.5C30.3284 17.2 31 17.8716 31 18.7V21.3C31 22.1284 30.3284 22.8 29.5 22.8H22.8V29.5C22.8 30.3284 22.1284 31 21.3 31H18.7C17.8716 31 17.2 30.3284 17.2 29.5V22.8H10.5C9.67157 22.8 9 22.1284 9 21.3V18.7C9 17.8716 9.67157 17.2 10.5 17.2H17.2V10.5Z"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
