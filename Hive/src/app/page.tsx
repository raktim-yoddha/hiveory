"use client";

import dynamic from 'next/dynamic';

// Dynamically import the main page component to avoid SSR issues with Tauri APIs
const HomePage = dynamic(() => import('./HomePage'), { ssr: false });

export default function Page() {
  return <HomePage />;
}
